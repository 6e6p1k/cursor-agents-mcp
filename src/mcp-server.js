#!/usr/bin/env node
/**
 * @file MCP stdio entrypoint.
 *
 * Deliberately thin: it advertises the tool catalogue and dispatches calls.
 * No agent work happens in this process, because a stdio MCP server dies with
 * the Claude Code session and a half-finished refactor should not die with it.
 * See docs/architecture.md.
 */

import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { findTool, TOOLS } from "./tools/index.js";

/**
 * Identifies this server instance, and therefore this Claude Code session.
 *
 * Claude Code does not pass its session id over MCP, but it does spawn one
 * stdio server per session, so the server's own lifetime is the session's.
 */
const SESSION_ID = randomUUID();

/**
 * Renders a handler's return value as MCP tool content.
 *
 * @param {unknown} value Whatever the handler resolved to.
 * @returns {{content: Array<{type: "text", text: string}>}} MCP tool result.
 */
function toContent(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

/**
 * Builds and connects the MCP server over stdio.
 *
 * @returns {Promise<void>} Resolves once the transport is connected.
 */
async function main() {
  const server = new Server(
    { name: "cursor-agents", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = findTool(request.params.name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
    }
    try {
      return toContent(await tool.handler(request.params.arguments ?? {}, SESSION_ID));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`cursor-agents-mcp failed to start: ${err}\n`);
  process.exit(1);
});
