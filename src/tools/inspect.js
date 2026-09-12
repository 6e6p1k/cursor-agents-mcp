/**
 * @file The read-side tools — `list`, `inspect` and `wait`.
 *
 * All three read the on-disk record rather than talking to a runner, so they
 * work for agents this process never launched. Output is deliberately terse:
 * see docs/context-economy.md for why none of these returns a transcript.
 */

import { agentPaths } from "../paths.js";
import { listRecords, readLines, readMeta, readResult, readStatus, TERMINAL_STATES } from "../store.js";
import { renderDigest } from "../digest.js";
import { estimateCostUsd } from "../models.js";

/** Default seconds `wait` blocks before returning partial progress. */
const DEFAULT_WAIT_SECONDS = 120;

/** Hard ceiling on a single `wait` call, to stay under MCP client timeouts. */
const MAX_WAIT_SECONDS = 600;

/** Poll interval while waiting on status files, in ms. */
const WAIT_POLL_MS = 700;

/**
 * Formats a duration as a compact human string.
 *
 * @param {number} ms Elapsed milliseconds.
 * @returns {string} e.g. `4s`, `3m12s`, `1h04m`.
 */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Summarises one record as a single list row.
 *
 * @param {{id: string, meta: any, status: any}} record A stored agent record.
 * @returns {string} One line describing the agent.
 */
function formatRow(record) {
  const { id, meta, status } = record;
  const started = status.startedAt ?? meta.createdAt;
  const end = status.endedAt ?? Date.now();
  const usd = estimateCostUsd(meta.model?.id, status.usage);
  const cost = usd == null ? "" : ` ~$${usd.toFixed(3)}`;
  const activity = status.lastActivity ? ` · ${status.lastActivity}` : "";
  return `${id}  [${status.state}] ${formatElapsed(end - started)}${cost}  "${meta.title}"${activity}`;
}

/**
 * Lists known agents.
 *
 * @param {object} input Tool arguments.
 * @param {"session"|"cwd"|"all"} [input.scope] Which agents to include.
 * @param {boolean} [input.activeOnly] Exclude finished, errored and cancelled.
 * @param {string} [sessionId] The calling Claude Code session id.
 * @returns {Promise<string>} A compact table, one agent per line.
 */
export async function list(input, sessionId) {
  const scope = input.scope ?? "session";
  const filter = { activeOnly: Boolean(input.activeOnly) };
  if (scope === "session") filter.sessionId = sessionId ?? null;
  if (scope === "cwd") filter.cwd = process.cwd();

  const records = await listRecords(filter);
  if (records.length === 0) return `No agents match scope="${scope}".`;
  return records.map(formatRow).join("\n");
}

/**
 * Reports what one agent has done, as a compact digest.
 *
 * @param {object} input Tool arguments.
 * @param {string} input.id Short agent id.
 * @param {number} [input.since] Return only digest entries newer than this seq.
 * @param {boolean} [input.includeResult] Append the final result text.
 * @returns {Promise<string>} Status header, digest lines and a cursor.
 * @throws {Error} If the agent is unknown.
 */
export async function inspect(input) {
  const [meta, status] = await Promise.all([readMeta(input.id), readStatus(input.id)]);
  if (!meta || !status) throw new Error(`unknown agent ${input.id}`);

  const entries = await readLines(input.id, "digest", input.since ?? 0);
  const lastSeq = entries.length > 0 ? entries[entries.length - 1].seq : (input.since ?? 0);
  const started = status.startedAt ?? meta.createdAt;
  const end = status.endedAt ?? Date.now();

  const parts = [
    `${input.id} "${meta.title}" — ${status.state}, ${formatElapsed(end - started)}, turn ${status.turns ?? 0}`,
    renderDigest(entries),
  ];

  if (status.error) parts.push(`error: ${status.error.message}`);
  if (input.includeResult && TERMINAL_STATES.includes(status.state)) {
    parts.push(`--- result ---\n${(await readResult(input.id)) ?? "(empty)"}`);
  }
  parts.push(
    `since=${lastSeq} · full transcript: ${agentPaths(input.id).events}`,
  );
  return parts.join("\n");
}

/**
 * Blocks until the named agents reach a terminal state, or the timeout expires.
 *
 * Prefer the background-task bridge (`attachCommand` from `spawn`) over this:
 * a blocked MCP call blocks the whole orchestrator turn. This exists for the
 * case where there is genuinely nothing else to do.
 *
 * @param {object} input Tool arguments.
 * @param {string[]} input.ids Agent ids to wait on.
 * @param {"all"|"any"} [input.mode] Whether to return on the first finisher.
 * @param {number} [input.timeoutSec] Seconds to block before giving up.
 * @returns {Promise<string>} Per-agent status, plus digests for finishers.
 */
export async function wait(input) {
  const ids = input.ids ?? [];
  const mode = input.mode ?? "all";
  const budgetMs = Math.min(input.timeoutSec ?? DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS) * 1000;
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const states = await Promise.all(ids.map(async (id) => (await readStatus(id))?.state ?? "unknown"));
    const done = states.filter((s) => TERMINAL_STATES.includes(s)).length;
    if (mode === "any" ? done > 0 : done === ids.length) break;
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }

  const reports = await Promise.all(
    ids.map(async (id) => {
      const status = await readStatus(id);
      if (!status) return `${id}: unknown agent`;
      if (!TERMINAL_STATES.includes(status.state)) {
        return `${id}: still ${status.state} — ${status.lastActivity ?? "no activity yet"}`;
      }
      return await inspect({ id, includeResult: true });
    }),
  );
  return reports.join("\n\n");
}
