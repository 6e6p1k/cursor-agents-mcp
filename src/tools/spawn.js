/**
 * @file The `spawn` and `follow_up` tools — everything that starts a run.
 *
 * Both return as soon as the detached runner is launched. Neither ever waits
 * for the agent, which is what keeps the orchestrator free. See docs/tools.md.
 */

import { spawn as spawnProcess } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveModel, requestsFastTier } from "../models.js";
import { agentPaths, newAgentId } from "../paths.js";
import { createRecord, patchStatus, readMeta, readStatus, TERMINAL_STATES } from "../store.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the runner entrypoint. */
const RUNNER = join(HERE, "..", "runner.js");

/** Absolute path to the CLI, used for the background-task bridge hint. */
const CLI = join(HERE, "..", "..", "bin", "cursor-agents.js");

/**
 * Launches a detached runner for an agent that already has a record on disk.
 *
 * The child is detached and unref'd so it survives both this MCP server and the
 * Claude Code session; its stdio goes to a log file because a detached process
 * cannot inherit a parent pipe that may close underneath it.
 *
 * @param {string} id Short agent id.
 * @param {"create"|"resume"} action Whether to start or continue the agent.
 * @returns {number|undefined} The runner's process id.
 */
function launchRunner(id, action) {
  const log = openSync(agentPaths(id).runnerLog, "a");
  const child = spawnProcess(process.execPath, [RUNNER, id, action], {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  return child.pid;
}

/**
 * Builds the instructions for bridging an agent into Claude Code's task panel.
 *
 * The panel labels each row from the `description` passed to the Bash tool —
 * not from the command line — so the description has to carry the agent's
 * title, or the row reads as plumbing ("Attach to the cursor agent") instead of
 * as the work being done.
 *
 * @param {string} id Short agent id.
 * @param {string} title Human-readable agent title.
 * @returns {{attachCommand: string, attachDescription: string, note: string}}
 *   The command, the description to label it with, and how to use them.
 */
export function attachInstructions(id, title) {
  return {
    attachCommand: `node ${CLI} attach ${id} --title ${JSON.stringify(title)}`,
    attachDescription: title,
    note:
      "Run attachCommand via Bash with run_in_background:true, passing " +
      "attachDescription VERBATIM as the Bash tool's description — the task " +
      "panel labels the row from that description, so anything else hides what " +
      "the agent is doing. Its exit will notify you; do not poll.",
  };
}

/**
 * Starts a brand new agent.
 *
 * @param {object} input Tool arguments.
 * @param {string} input.title Short imperative description, shown to the user.
 * @param {string} input.prompt Self-contained brief for the agent.
 * @param {string} [input.cwd] Working directory; defaults to the server's.
 * @param {string} [input.model] Base model id.
 * @param {string} [input.effort] Reasoning effort.
 * @param {boolean} [input.readOnly] Run in plan mode with writes disallowed.
 * @param {boolean} [input.sandbox] Enable Cursor's sandbox.
 * @param {boolean} [input.allowFast] Permit the roughly-double-price fast tier.
 * @param {string} [sessionId] Claude Code session that requested the spawn.
 * @returns {Promise<object>} The new agent's id, title and attach command.
 * @throws {Error} If the fast tier is requested without `allowFast`.
 */
export async function spawn(input, sessionId) {
  if (input.model && requestsFastTier(input.model) && !input.allowFast) {
    throw new Error(
      `Model "${input.model}" selects the fast tier, which costs roughly double ` +
        `(grok-4.5-fast is $18/M output vs $6/M). Pass allowFast: true to confirm.`,
    );
  }

  const id = newAgentId();
  const meta = {
    id,
    title: input.title,
    model: resolveModel(input),
    cwd: input.cwd || process.cwd(),
    readOnly: Boolean(input.readOnly),
    sandbox: Boolean(input.sandbox),
    sessionId: sessionId ?? null,
    createdAt: Date.now(),
    turns: 0,
  };

  await createRecord(id, meta);
  writeFileSync(agentPaths(id).prompt, input.prompt, "utf8");
  const pid = launchRunner(id, "create");

  return {
    id,
    title: meta.title,
    model: `${meta.model.id} (effort=${meta.model.params[0].value}, fast=${meta.model.params[1].value})`,
    cwd: meta.cwd,
    pid,
    ...attachInstructions(id, meta.title),
  };
}

/**
 * Sends another turn to an existing agent, preserving its full conversation.
 *
 * @param {object} input Tool arguments.
 * @param {string} input.id Short agent id.
 * @param {string} input.prompt The follow-up message.
 * @returns {Promise<object>} The agent's id, title and attach command.
 * @throws {Error} If the agent is unknown or still running.
 */
export async function followUp(input) {
  const meta = await readMeta(input.id);
  if (!meta) throw new Error(`unknown agent ${input.id}`);

  const status = await readStatus(input.id);
  if (status && !TERMINAL_STATES.includes(status.state)) {
    throw new Error(
      `Agent ${input.id} is still ${status.state}. Use steer to redirect it mid-run, ` +
        `or stop it first.`,
    );
  }

  writeFileSync(agentPaths(input.id).prompt, input.prompt, "utf8");
  // Flip out of the previous turn's terminal state before returning, so a
  // caller that immediately waits or attaches does not observe the old result.
  await patchStatus(input.id, { state: "starting", endedAt: null, error: null, lastActivity: null });
  const pid = launchRunner(input.id, "resume");

  const instructions = attachInstructions(input.id, meta.title);
  return {
    id: input.id,
    title: meta.title,
    pid,
    ...instructions,
    note: `Resumed with full prior context. ${instructions.note}`,
  };
}
