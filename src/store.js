/**
 * @file Reading and writing agent records on disk.
 *
 * JSON documents are rewritten atomically (write-temp-then-rename) because the
 * MCP server, the CLI and the statusline all read them while a detached runner
 * writes them. Append-only logs need no such care. See docs/architecture.md.
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { agentPaths, agentsDir } from "./paths.js";

/** Statuses from which an agent will not move on its own. */
export const TERMINAL_STATES = ["finished", "error", "cancelled"];

/**
 * Writes a JSON document atomically.
 *
 * @param {string} file Absolute destination path.
 * @param {unknown} data Value to serialise.
 * @returns {Promise<void>} Resolves once the rename completes.
 */
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
}

/**
 * Reads a JSON document, tolerating absence and partial writes.
 *
 * @param {string} file Absolute path to read.
 * @returns {Promise<any|null>} The parsed value, or null if missing/unreadable.
 */
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Creates an agent record directory and its initial documents.
 *
 * @param {string} id Short agent id.
 * @param {object} meta Immutable facts about the agent (title, model, cwd, ...).
 * @returns {Promise<void>} Resolves once meta and status are on disk.
 */
export async function createRecord(id, meta) {
  const p = agentPaths(id);
  await mkdir(p.dir, { recursive: true });
  await writeJsonAtomic(p.meta, meta);
  await writeJsonAtomic(p.status, {
    state: "starting",
    createdAt: meta.createdAt,
    updatedAt: Date.now(),
    turns: 0,
  });
}

/**
 * Reads an agent's immutable metadata.
 *
 * @param {string} id Short agent id.
 * @returns {Promise<any|null>} Parsed meta, or null when the agent is unknown.
 */
export async function readMeta(id) {
  return readJson(agentPaths(id).meta);
}

/**
 * Reads an agent's current status.
 *
 * @param {string} id Short agent id.
 * @returns {Promise<any|null>} Parsed status, or null when the agent is unknown.
 */
export async function readStatus(id) {
  return readJson(agentPaths(id).status);
}

/**
 * Merges fields into an agent's status document.
 *
 * @param {string} id Short agent id.
 * @param {object} patch Fields to merge over the existing status.
 * @returns {Promise<object>} The status as written.
 */
export async function patchStatus(id, patch) {
  const p = agentPaths(id);
  const next = { ...((await readJson(p.status)) ?? {}), ...patch, updatedAt: Date.now() };
  await writeJsonAtomic(p.status, next);
  return next;
}

/**
 * Appends one record to an agent's append-only log.
 *
 * @param {string} id Short agent id.
 * @param {"events"|"digest"|"control"} log Which log to append to.
 * @param {object} entry Value to serialise as one JSON line.
 * @returns {Promise<void>} Resolves once the line is flushed.
 */
export async function appendLine(id, log, entry) {
  await appendFile(agentPaths(id)[log], `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Reads a JSONL log, optionally skipping entries already seen.
 *
 * @param {string} id Short agent id.
 * @param {"events"|"digest"|"control"} log Which log to read.
 * @param {number} [since] Return only entries whose `seq` exceeds this value.
 * @returns {Promise<object[]>} Parsed entries in write order.
 */
export async function readLines(id, log, since = 0) {
  const file = agentPaths(id)[log];
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if ((entry.seq ?? 0) > since) out.push(entry);
    } catch {
      // A torn final line means the runner is mid-append; it lands next read.
    }
  }
  return out;
}

/**
 * Finds the highest sequence number in a batch of log entries.
 *
 * Used to resume reading an append-only log from its current end, so entries
 * written during an earlier turn are not replayed.
 *
 * @param {Array<{seq?: number}>} entries Log entries.
 * @returns {number} The greatest `seq` present, or 0 when there are none.
 */
export function latestSeq(entries) {
  return entries.reduce((max, entry) => Math.max(max, entry.seq ?? 0), 0);
}

/**
 * Lists every known agent, newest first.
 *
 * @param {object} [filter] Optional filters.
 * @param {string} [filter.sessionId] Keep only agents spawned by this session.
 * @param {string} [filter.cwd] Keep only agents whose working directory matches.
 * @param {boolean} [filter.activeOnly] Keep only non-terminal agents.
 * @returns {Promise<Array<{id: string, meta: any, status: any}>>} Matching records.
 */
export async function listRecords(filter = {}) {
  let ids;
  try {
    ids = await readdir(agentsDir());
  } catch {
    return [];
  }

  const records = [];
  for (const id of ids) {
    const [meta, status] = await Promise.all([readMeta(id), readStatus(id)]);
    if (!meta || !status) continue;
    if (filter.sessionId && meta.sessionId !== filter.sessionId) continue;
    if (filter.cwd && meta.cwd !== filter.cwd) continue;
    if (filter.activeOnly && TERMINAL_STATES.includes(status.state)) continue;
    records.push({ id, meta, status });
  }
  records.sort((a, b) => (b.meta.createdAt ?? 0) - (a.meta.createdAt ?? 0));
  return records;
}

/**
 * Writes an agent's final assistant text.
 *
 * @param {string} id Short agent id.
 * @param {string} text Final result text.
 * @returns {Promise<void>} Resolves once written.
 */
export async function writeResult(id, text) {
  await writeFile(agentPaths(id).result, text ?? "", "utf8");
}

/**
 * Reads an agent's final assistant text.
 *
 * @param {string} id Short agent id.
 * @returns {Promise<string|null>} The text, or null when the run has not ended.
 */
export async function readResult(id) {
  try {
    return await readFile(agentPaths(id).result, "utf8");
  } catch {
    return null;
  }
}
