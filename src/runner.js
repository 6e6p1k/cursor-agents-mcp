/**
 * @file The detached process that owns one Cursor agent for one turn.
 *
 * Spawned by the MCP server with `detached: true` and immediately unref'd, so a
 * run outlives both the MCP server and the Claude Code session that started it.
 * It talks to the rest of the system only through the record on disk.
 *
 * Usage: `node src/runner.js <agentId> <create|resume>`
 */

import { readFile, unlink } from "node:fs/promises";
import { Agent } from "@cursor/sdk";
import { agentOptions } from "./agent-options.js";
import { digestMessage, textEntry } from "./digest.js";
import { agentPaths } from "./paths.js";
import { appendLine, latestSeq, patchStatus, readLines, readMeta, readStatus, writeResult } from "./store.js";

/** How often the control log is checked for steer/cancel requests, in ms. */
const CONTROL_POLL_MS = 500;


/**
 * Applies any steer or cancel requests written since the last check.
 *
 * @param {string} id Short agent id.
 * @param {import("@cursor/sdk").Run} run The in-flight run.
 * @param {{seq: number}} cursor Mutable cursor tracking consumed control lines.
 * @returns {Promise<void>} Resolves once pending requests are applied.
 */
async function drainControl(id, run, cursor) {
  const pending = await readLines(id, "control", cursor.seq);
  for (const entry of pending) {
    cursor.seq = Math.max(cursor.seq, entry.seq ?? 0);
    try {
      if (entry.op === "cancel" && run.supports("cancel")) {
        await run.cancel();
      } else if (entry.op === "steer" && typeof run.steer === "function") {
        await run.steer(entry.text);
      }
    } catch (err) {
      await appendLine(id, "digest", {
        seq: Date.now(),
        t: Date.now(),
        kind: "status",
        text: `control ${entry.op} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}

/**
 * Runs one turn to completion, recording everything to the agent's record.
 *
 * @param {string} id Short agent id.
 * @param {"create"|"resume"} action Whether to start a new agent or continue one.
 * @returns {Promise<void>} Resolves after terminal status is written.
 */
async function main(id, action) {
  const meta = await readMeta(id);
  if (!meta) throw new Error(`unknown agent ${id}`);

  const paths = agentPaths(id);
  const prompt = await readFile(paths.prompt, "utf8");
  await unlink(paths.prompt).catch(() => {});

  const agent =
    action === "resume"
      ? await Agent.resume(meta.sdkAgentId, agentOptions(meta))
      : await Agent.create(agentOptions(meta));

  await patchStatus(id, {
    state: "running",
    sdkAgentId: agent.agentId,
    startedAt: Date.now(),
    endedAt: null,
  });
  if (!meta.sdkAgentId) {
    meta.sdkAgentId = agent.agentId;
    await appendLine(id, "digest", { seq: 0, t: Date.now(), kind: "status", text: "agent created" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(paths.meta, JSON.stringify(meta, null, 2), "utf8");
  }

  const run = await agent.send(prompt);
  await patchStatus(id, { runId: run.id });

  // Start past every control entry already on disk: the log is append-only and
  // shared across turns, so a cancel from a previous turn must not replay here.
  const prior = await readLines(id, "control", 0);
  const cursor = { seq: latestSeq(prior) };
  const poller = setInterval(() => {
    drainControl(id, run, cursor).catch(() => {});
  }, CONTROL_POLL_MS);

  let seq = Date.now();
  let textBuffer = "";
  let lastText = "";

  /**
   * Writes one digest entry and mirrors it into the status document.
   *
   * @param {{kind: string, text: string}} entry The entry to record.
   * @returns {Promise<void>} Resolves once both writes land.
   */
  const record = async (entry) => {
    seq += 1;
    await appendLine(id, "digest", { seq, t: Date.now(), ...entry });
    await patchStatus(id, { lastActivity: entry.text, digestSeq: seq });
  };

  /**
   * Flushes buffered assistant narration as a single digest entry.
   *
   * Assistant messages arrive as individual token deltas, so digesting them as
   * they stream would produce one line per word.
   *
   * @returns {Promise<void>} Resolves once any pending text is recorded.
   */
  const flushText = async () => {
    const entry = textEntry(textBuffer);
    textBuffer = "";
    if (!entry) return;
    lastText = entry.text;
    await record(entry);
  };

  try {
    for await (const msg of run.stream()) {
      seq += 1;
      await appendLine(id, "events", { seq, t: Date.now(), msg });

      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block?.type === "text") textBuffer += block.text;
        }
        continue;
      }
      if (msg.type === "usage") {
        await patchStatus(id, { usage: msg.usage });
        continue;
      }

      const entry = digestMessage(msg, meta.cwd);
      // Narration is flushed first so it reads as the reason for the action.
      if (entry) {
        await flushText();
        await record(entry);
      }
    }
    await flushText();
  } finally {
    clearInterval(poller);
  }

  const result = await run.wait();
  await writeResult(id, result.result ?? lastText ?? "");
  await patchStatus(id, {
    state: result.status,
    endedAt: Date.now(),
    durationMs: result.durationMs,
    usage: result.usage,
    error: result.error ?? null,
    turns: ((await readStatus(id))?.turns ?? 0) + 1,
  });
  await agent[Symbol.asyncDispose]();
}

const [, , agentId, action] = process.argv;
main(agentId, action === "resume" ? "resume" : "create").catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  await patchStatus(agentId, {
    state: "error",
    endedAt: Date.now(),
    error: { message },
  }).catch(() => {});
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
