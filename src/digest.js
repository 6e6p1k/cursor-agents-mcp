/**
 * @file Turning raw SDK stream messages into compact digest lines.
 *
 * The whole point of delegating to a cheaper model is spending fewer
 * orchestrator tokens, so `inspect` must never return a transcript. The full
 * stream still lands in events.jsonl for shell inspection; this module produces
 * the one-line-per-action view. See docs/context-economy.md.
 */

import { relative, isAbsolute } from "node:path";

/** Argument keys that carry a file path, in the order we prefer them. */
const PATH_KEYS = ["path", "file_path", "filePath", "target_file", "targetFile", "relative_workspace_path"];

/** Argument keys that carry a command or query string. */
const TEXT_KEYS = ["command", "pattern", "query", "search", "prompt"];

/** Maximum characters kept from any single digest line. */
const MAX_LINE = 160;

/**
 * Shortens a string to one line, marking it when characters were dropped.
 *
 * @param {string} text Input text.
 * @param {number} [max] Maximum length of the result, ellipsis included.
 * @returns {string} The trimmed, single-line result.
 */
export function truncate(text, max = MAX_LINE) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Rewrites an absolute path as relative to the agent's working directory.
 *
 * Agents report absolute paths, which dominate a digest line and tell the
 * orchestrator nothing it does not already know.
 *
 * @param {string} value A path or arbitrary string.
 * @param {string} [cwd] The agent's working directory.
 * @returns {string} A workspace-relative path, or the input unchanged.
 */
export function relativise(value, cwd) {
  if (!cwd || !isAbsolute(value)) return value;
  const rel = relative(cwd, value);
  return rel && !rel.startsWith("..") ? rel : value;
}

/**
 * Extracts the most descriptive scalar from a tool call's arguments.
 *
 * Tool argument schemas are typed as `unknown` on the wire and have changed
 * shape across SDK releases, so this probes known keys rather than destructuring.
 *
 * @param {unknown} args Raw tool arguments.
 * @param {string} [cwd] The agent's working directory, for path shortening.
 * @returns {string} A short descriptor, or the empty string when nothing fits.
 */
export function describeArgs(args, cwd) {
  if (!args || typeof args !== "object") return "";
  const record = /** @type {Record<string, unknown>} */ (args);

  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value) return relativise(value, cwd);
  }
  for (const key of TEXT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value) return truncate(value, 80);
  }
  return "";
}

/**
 * Converts one SDK stream message into a digest entry.
 *
 * Assistant messages always return null: they arrive as individual token
 * deltas, so the runner accumulates them and emits one entry per turn via
 * {@link textEntry}.
 *
 * @param {any} msg A message from `run.stream()`.
 * @param {string} [cwd] The agent's working directory.
 * @returns {{kind: string, text: string}|null} The entry, or null for messages
 *   carrying no orchestrator-relevant signal.
 */
export function digestMessage(msg, cwd) {
  if (!msg || typeof msg !== "object") return null;

  if (msg.type === "tool_call") {
    // Only completed calls are logged: a running call is always followed by its
    // completion, and logging both would double every line.
    if (msg.status === "running") return null;
    const detail = describeArgs(msg.args, cwd);
    const failed = msg.status === "error" ? " [failed]" : "";
    return {
      kind: "tool",
      text: truncate(detail ? `${msg.name} ${detail}${failed}` : `${msg.name}${failed}`),
    };
  }

  // Bare lifecycle transitions (RUNNING, FINISHED) duplicate status.json; only
  // status messages carrying an explanation are worth a line.
  if (msg.type === "status" && msg.message) {
    return { kind: "status", text: truncate(msg.message) };
  }

  return null;
}

/**
 * Builds a digest entry from accumulated assistant text.
 *
 * @param {string} text Concatenated assistant token deltas for one turn.
 * @returns {{kind: string, text: string}|null} The entry, or null when blank.
 */
export function textEntry(text) {
  const trimmed = String(text).trim();
  return trimmed ? { kind: "text", text: truncate(trimmed) } : null;
}

/**
 * Renders digest entries as the compact block returned by `inspect`.
 *
 * @param {Array<{kind: string, text: string}>} entries Entries in write order.
 * @returns {string} One line per entry, or a placeholder when empty.
 */
export function renderDigest(entries) {
  if (entries.length === 0) return "(no activity yet)";
  return entries
    .map((e) => {
      const mark = e.kind === "text" ? "»" : e.kind === "status" ? "·" : "—";
      return `${mark} ${e.text}`;
    })
    .join("\n");
}
