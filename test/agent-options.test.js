/** @file Unit tests for translating a record into SDK agent options. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentOptions, READ_ONLY_DISALLOWED, settingSources } from "../src/agent-options.js";

/**
 * The SDK's tool vocabulary, as reported by `Agent.create` when rejecting an
 * unknown name. Only the entries relevant to write access are listed.
 */
const KNOWN_TOOLS = new Set([
  "applyAgentDiff", "delete", "edit", "glob", "grep", "ls", "mcp", "piEdit",
  "piRead", "piWrite", "read", "readLints", "semSearch", "shell", "task",
  "updateTodos", "webFetch", "webSearch",
]);

/** A minimal stored record. */
const META = { id: "ag_test", title: "t", cwd: "/repo", model: { id: "grok-4.6", params: [] } };

describe("READ_ONLY_DISALLOWED", () => {
  it("contains only names the SDK actually accepts", () => {
    // Regression: "write" is not a tool, and including it made every readOnly
    // agent fail at create time before running at all.
    for (const name of READ_ONLY_DISALLOWED) {
      assert.ok(KNOWN_TOOLS.has(name), `${name} is not a valid SDK tool name`);
    }
  });

  it("withholds every way of changing a file", () => {
    for (const name of ["edit", "delete", "applyAgentDiff", "piEdit", "piWrite"]) {
      assert.ok(READ_ONLY_DISALLOWED.includes(name));
    }
  });
});

describe("agentOptions", () => {
  it("runs in agent mode with writes allowed by default", () => {
    const options = agentOptions(META);
    assert.equal(options.mode, "agent");
    assert.equal(options.disallowedTools, undefined);
  });

  it("switches to plan mode and withholds write tools when readOnly", () => {
    const options = agentOptions({ ...META, readOnly: true });
    assert.equal(options.mode, "plan");
    assert.deepEqual(options.disallowedTools, READ_ONLY_DISALLOWED);
  });

  it("leaves the sandbox off unless asked, since it blocks all MCP tools", () => {
    assert.equal(agentOptions(META).local.sandboxOptions.enabled, false);
    assert.equal(agentOptions({ ...META, sandbox: true }).local.sandboxOptions.enabled, true);
  });

  it("always loads project MCP servers", () => {
    assert.deepEqual(agentOptions(META).local.settingSources, settingSources());
    assert.ok(settingSources().includes("project"));
  });

  it("gives each agent its own store, to avoid cross-runner lock contention", () => {
    const a = agentOptions({ ...META, id: "ag_one" });
    const b = agentOptions({ ...META, id: "ag_two" });
    assert.ok(a.local.store);
    assert.notEqual(a.local.store, b.local.store);
  });

  it("passes through the caller's model and title", () => {
    const options = agentOptions({ ...META, title: "port auth tests" });
    assert.equal(options.name, "port auth tests");
    assert.equal(options.model.id, "grok-4.6");
  });
});
