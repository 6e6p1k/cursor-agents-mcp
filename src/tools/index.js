/**
 * @file The MCP tool registry — schemas, descriptions and dispatch.
 *
 * Tool descriptions are load-bearing: they are the only place the orchestrator
 * learns that prompts must be self-contained and that `wait` is a fallback
 * rather than the normal way to collect a result. See docs/tools.md.
 */

import { followUp, spawn } from "./spawn.js";
import { inspect, list, wait } from "./inspect.js";
import { steer, stop } from "./control.js";

/** JSON Schema fragment shared by every tool that names an agent. */
const AGENT_ID = { type: "string", description: "Short agent id, e.g. ag_7f3k2m." };

/**
 * The full tool catalogue advertised over MCP.
 *
 * @type {Array<{name: string, description: string, inputSchema: object,
 *   handler: (input: any, sessionId?: string) => Promise<unknown>}>}
 */
export const TOOLS = [
  {
    name: "spawn",
    description:
      "Delegate a task to a Cursor agent (Grok by default) running detached in the background. " +
      "Returns immediately with an agent id — it does NOT wait. " +
      "The agent shares none of your context, so `prompt` must be a self-contained brief: " +
      "name the files, the goal, and how to verify. " +
      "Project AGENTS.md, .cursor/rules, .agents/skills and .cursor/mcp.json are honored automatically. " +
      "After spawning, run the returned attachCommand via Bash with run_in_background:true, passing " +
      "the returned attachDescription VERBATIM as the Bash tool's description. The task panel labels " +
      "the row from that description, so a generic one hides what the agent is doing from the user. " +
      "The task's exit notifies you when the agent finishes — do not poll.",
    inputSchema: {
      type: "object",
      required: ["title", "prompt"],
      properties: {
        title: {
          type: "string",
          description:
            "Short imperative description shown to the user in the task panel and status line, " +
            'e.g. "port auth tests to vitest". Not a generic label.',
        },
        prompt: { type: "string", description: "Self-contained brief for the agent." },
        cwd: { type: "string", description: "Working directory. Defaults to the project root." },
        model: { type: "string", description: "Base model id: grok-4.6 (default) or grok-4.5." },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "xhigh"],
          description: "Reasoning effort, default high. Use low for genuinely trivial work; high costs ~16s of latency floor.",
        },
        readOnly: {
          type: "boolean",
          description: "Plan mode with edit/write/delete disallowed. Use for research and review.",
        },
        sandbox: {
          type: "boolean",
          description:
            "Enable Cursor's sandbox. Blocks ALL MCP tool calls and shell network access. Off by default.",
        },
        allowFast: {
          type: "boolean",
          description: "Permit the fast model tier, which costs roughly double. Only with explicit user consent.",
        },
      },
    },
    handler: spawn,
  },
  {
    name: "follow_up",
    description:
      "Send another turn to an existing agent, keeping its full conversation. " +
      "Use this instead of spawning a fresh agent whenever the work builds on what that agent already did — " +
      "it keeps the context and costs far less. The agent must have finished; use steer for a live run.",
    inputSchema: {
      type: "object",
      required: ["id", "prompt"],
      properties: { id: AGENT_ID, prompt: { type: "string", description: "The follow-up message." } },
    },
    handler: followUp,
  },
  {
    name: "list",
    description: "List agents with their state, elapsed time, cost and latest activity. One line each.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "cwd", "all"],
          description: "session (default) = spawned by this Claude session; cwd = this directory; all = everything.",
        },
        activeOnly: { type: "boolean", description: "Exclude finished, errored and cancelled agents." },
      },
    },
    handler: list,
  },
  {
    name: "inspect",
    description:
      "Show what one agent has done, as a compact digest — one line per tool call, not a transcript. " +
      "Pass the `since` value from a previous call to get only new activity. " +
      "The reply names the full transcript file; read it with shell tools only if the digest is genuinely insufficient.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: AGENT_ID,
        since: { type: "number", description: "Return only entries newer than this seq (from a prior inspect)." },
        includeResult: { type: "boolean", description: "Append the agent's final answer, if it has finished." },
      },
    },
    handler: inspect,
  },
  {
    name: "wait",
    description:
      "Block until the named agents finish. This blocks YOUR whole turn, so prefer the background-task " +
      "bridge from spawn — use this only when there is genuinely nothing else to do. " +
      "On timeout it returns progress rather than nothing.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Agent ids to wait on." },
        mode: { type: "string", enum: ["all", "any"], description: "Return on the first finisher, or all. Default all." },
        timeoutSec: { type: "number", description: "Seconds to block. Default 120, max 600." },
      },
    },
    handler: wait,
  },
  {
    name: "steer",
    description:
      "Inject a message into an agent's turn while it is still running, without killing its work. " +
      "Use this to correct course mid-run — it is strictly better than stopping and re-prompting.",
    inputSchema: {
      type: "object",
      required: ["id", "text"],
      properties: { id: AGENT_ID, text: { type: "string", description: "Message to inject." } },
    },
    handler: steer,
  },
  {
    name: "stop",
    description: "Cancel an agent's current run. The agent stays resumable via follow_up.",
    inputSchema: { type: "object", required: ["id"], properties: { id: AGENT_ID } },
    handler: stop,
  },
];

/**
 * Looks up a tool by its advertised name.
 *
 * @param {string} name Tool name from the MCP request.
 * @returns {(typeof TOOLS)[number]|undefined} The registry entry, if any.
 */
export function findTool(name) {
  return TOOLS.find((t) => t.name === name);
}
