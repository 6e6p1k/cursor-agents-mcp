/**
 * @file On-disk layout for agent records.
 *
 * Every agent owns one directory under the state root. All inter-process
 * communication in this server happens through these files, which is what lets
 * detached runners, the MCP server, the CLI and the statusline all read the
 * same state without an IPC channel. See docs/architecture.md.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the root directory holding every agent record.
 *
 * @returns {string} Absolute path, overridable via `CURSOR_AGENTS_STATE_ROOT`.
 */
export function stateRoot() {
  return process.env.CURSOR_AGENTS_STATE_ROOT || join(homedir(), ".cursor-agents-mcp");
}

/**
 * Resolves the directory holding all agent records.
 *
 * @returns {string} Absolute path to the agents directory.
 */
export function agentsDir() {
  return join(stateRoot(), "agents");
}

/**
 * Resolves the paths that make up a single agent's record.
 *
 * @param {string} id Short agent id, e.g. `ag_7f3k2m`.
 * @returns {{dir: string, meta: string, status: string, events: string,
 *   digest: string, control: string, prompt: string, result: string,
 *   sdkStore: string, runnerLog: string}}
 *   Absolute paths for every file in the record.
 */
export function agentPaths(id) {
  const dir = join(agentsDir(), id);
  return {
    dir,
    meta: join(dir, "meta.json"),
    status: join(dir, "status.json"),
    events: join(dir, "events.jsonl"),
    digest: join(dir, "digest.jsonl"),
    control: join(dir, "control.jsonl"),
    prompt: join(dir, "pending-prompt.txt"),
    result: join(dir, "result.md"),
    sdkStore: join(dir, "sdk-store"),
    runnerLog: join(dir, "runner.log"),
  };
}

/**
 * Generates a short, human-typable agent id.
 *
 * Deliberately not the SDK's `agent-<uuid>`: the record directory has to exist
 * before the SDK agent does, so the two ids are stored side by side in meta.
 *
 * @returns {string} An id of the form `ag_` plus six base36 characters.
 */
export function newAgentId() {
  return `ag_${Math.random().toString(36).slice(2, 8)}`;
}
