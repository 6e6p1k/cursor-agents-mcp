/**
 * @file Translating a stored agent record into Cursor SDK agent options.
 *
 * Split out of the runner so it can be unit tested: importing the runner would
 * execute it. Three of the decisions here are load-bearing and were each found
 * the hard way — see docs/sandbox-and-passthrough.md and docs/architecture.md.
 */

import { JsonlLocalAgentStore } from "@cursor/sdk";
import { agentPaths } from "./paths.js";

/**
 * Tools withheld from a `readOnly` agent.
 *
 * Every name must exist in the SDK's tool vocabulary or `Agent.create` throws
 * before the run starts. Notably there is no `write` tool — file creation goes
 * through `edit` — and the `pi*` variants are separate tools, not aliases.
 */
export const READ_ONLY_DISALLOWED = ["edit", "delete", "applyAgentDiff", "piEdit", "piWrite"];

/**
 * Setting layers loaded from disk. Only MCP servers are gated by this; rules,
 * `AGENTS.md` and skills come from the workspace scan regardless.
 */
export const SETTING_SOURCES = ["project", "user", "plugins"];

/**
 * Builds the options passed to `Agent.create` / `Agent.resume`.
 *
 * @param {any} meta The agent's stored metadata.
 * @returns {object} SDK agent options, including an isolated local store.
 */
export function agentOptions(meta) {
  /** @type {any} */
  const options = {
    model: meta.model,
    name: meta.title,
    mode: meta.readOnly ? "plan" : "agent",
    local: {
      cwd: meta.cwd,
      settingSources: SETTING_SOURCES,
      // Per-agent store. The SDK's default SQLite layout keeps one index.db for
      // the whole state root, which deadlocks ("database is locked") the moment
      // two runners start at once. Only one runner ever touches a given agent,
      // so an isolated store removes the contention entirely.
      store: new JsonlLocalAgentStore(agentPaths(meta.id).sdkStore),
      // Left off by default: a sandbox blocks every MCP tool call, because a
      // headless run cannot request approval and so fails closed.
      sandboxOptions: { enabled: Boolean(meta.sandbox) },
    },
  };
  if (meta.readOnly) options.disallowedTools = READ_ONLY_DISALLOWED;
  return options;
}
