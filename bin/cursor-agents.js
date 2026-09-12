#!/usr/bin/env node
/**
 * @file Command-line companion to the MCP server.
 *
 * Two jobs the MCP protocol cannot do itself: bridge an agent into Claude
 * Code's background task panel (`attach`), and render a live status line
 * (`statusline`). See docs/statusline.md.
 */

import { authExpiryWarning } from "../src/auth-status.js";
import { loadConfig } from "../src/config.js";
import { modelFamily } from "../src/models.js";
import { formatElapsed } from "../src/tools/inspect.js";
import { agentPaths } from "../src/paths.js";
import { listRecords, readLines, readResult, readStatus, TERMINAL_STATES } from "../src/store.js";
import { stop as stopAgent } from "../src/tools/control.js";

/** Poll interval while attached to a running agent, in ms. */
const ATTACH_POLL_MS = 1000;

/** Characters of the agent's final answer echoed on completion. */
const RESULT_PREVIEW = 1200;

/**
 * Reads a flag's value from an argv list.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @param {string} flag Flag name including dashes, e.g. `--title`.
 * @returns {string|undefined} The value following the flag, if present.
 */
function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Blocks until an agent reaches a terminal state, then prints a compact report.
 *
 * Run this via Claude Code's Bash tool with `run_in_background: true`: the
 * process appears in the background task panel and its exit re-invokes the
 * orchestrator, which is how an async agent reports back without polling.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {Promise<number>} Process exit code; 1 when the agent errored.
 */
async function attach(argv) {
  const id = argv[0];
  if (!id) {
    process.stderr.write("usage: cursor-agents attach <id> [--title <text>]\n");
    return 2;
  }

  const title = flagValue(argv, "--title") ?? id;
  process.stdout.write(`cursor agent ${id}: ${title}\n`);

  let status = await readStatus(id);
  if (!status) {
    process.stderr.write(`unknown agent ${id}\n`);
    return 2;
  }

  while (!TERMINAL_STATES.includes(status.state)) {
    await new Promise((r) => setTimeout(r, ATTACH_POLL_MS));
    status = (await readStatus(id)) ?? status;
  }

  const started = status.startedAt ?? status.createdAt ?? Date.now();
  const elapsed = formatElapsed((status.endedAt ?? Date.now()) - started);
  process.stdout.write(`${status.state} in ${elapsed}\n`);

  if (status.error) process.stdout.write(`error: ${status.error.message}\n`);

  const result = await readResult(id);
  if (result) {
    const trimmed = result.length > RESULT_PREVIEW ? `${result.slice(0, RESULT_PREVIEW)}…` : result;
    process.stdout.write(`\n${trimmed}\n`);
  }
  process.stdout.write(`\nfull transcript: ${agentPaths(id).events}\n`);
  return status.state === "error" ? 1 : 0;
}

/**
 * Prints one line per known agent, for humans at a terminal.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {Promise<number>} Process exit code.
 */
async function ls(argv) {
  const records = await listRecords({ activeOnly: argv.includes("--active") });
  if (records.length === 0) {
    process.stdout.write("no agents\n");
    return 0;
  }
  for (const { id, meta, status } of records) {
    const end = status.endedAt ?? Date.now();
    const started = status.startedAt ?? meta.createdAt;
    process.stdout.write(
      `${id}  ${String(status.state).padEnd(9)} ${formatElapsed(end - started).padStart(7)}  ${meta.title}\n`,
    );
  }
  return 0;
}

/**
 * Reads SDK auth status and formats a warning, swallowing every failure.
 *
 * @returns {Promise<string|null>} A warning, or null when healthy or unreadable.
 */
async function readAuthWarning() {
  try {
    const { Cursor } = await import("@cursor/sdk");
    return authExpiryWarning(await Cursor.auth.status(), Date.now(), loadConfig().keyWarnDays);
  } catch {
    return null;
  }
}

/**
 * Names the model family running, for the status-line prefix.
 *
 * Previously hardcoded to "grok", which misreported every other model.
 *
 * @param {Array<{meta: any}>} active Records for the running agents.
 * @returns {string} The shared family name, or "agents" when they differ.
 */
function activeLabel(active) {
  const families = new Set(active.map(({ meta }) => modelFamily(meta.model?.id)).filter(Boolean));
  return families.size === 1 ? [...families][0] : "agents";
}

/**
 * Renders the Claude Code status line segment for running agents.
 *
 * Prints nothing when no agent is running and the SDK key is healthy, so the
 * segment disappears rather than showing a zero. An auth warning still prints
 * with an empty agent list, because a lapsed key is otherwise silent. Claude
 * Code passes session JSON on stdin, which this command ignores: agents
 * intentionally outlive the session that spawned them.
 *
 * @returns {Promise<number>} Process exit code.
 */
async function statusline() {
  const [active, warning] = await Promise.all([listRecords({ activeOnly: true }), readAuthWarning()]);

  const segments = [];
  if (active.length > 0) {
    const parts = active.slice(0, 3).map(({ meta, status }) => {
      const started = status.startedAt ?? meta.createdAt;
      return `${meta.title} ${formatElapsed(Date.now() - started)}`;
    });
    const overflow = active.length > 3 ? ` +${active.length - 3}` : "";
    segments.push(`⚡ ${active.length} ${activeLabel(active)} · ${parts.join(" · ")}${overflow}`);
  }
  if (warning) segments.push(warning);
  if (segments.length > 0) process.stdout.write(segments.join(" · "));
  return 0;
}

/**
 * Prints the digest of one agent, for humans at a terminal.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {Promise<number>} Process exit code.
 */
async function log(argv) {
  const id = argv[0];
  if (!id) {
    process.stderr.write("usage: cursor-agents log <id>\n");
    return 2;
  }
  for (const entry of await readLines(id, "digest", 0)) {
    process.stdout.write(`${entry.text}\n`);
  }
  return 0;
}

/**
 * Cancels a running agent from the terminal.
 *
 * The MCP `stop` tool needs a connected client. Runners outlive the session
 * that spawned them, so there has to be a way to end one without that client.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {Promise<number>} Process exit code.
 */
async function stop(argv) {
  const id = argv[0];
  if (!id) {
    process.stderr.write("usage: cursor-agents stop <id>\n");
    return 2;
  }
  await stopAgent({ id });
  process.stdout.write(`cancel requested for ${id}\n`);
  return 0;
}

const [, , command, ...rest] = process.argv;
const commands = { attach, ls, log, statusline, stop };

if (!command || !(command in commands)) {
  process.stderr.write(`usage: cursor-agents <${Object.keys(commands).join("|")}>\n`);
  process.exit(2);
}

commands[command](rest)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
