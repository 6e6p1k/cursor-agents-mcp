/** @file Unit tests for the background-task bridge instructions. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { attachInstructions, shellQuote } from "../src/tools/spawn.js";

describe("attachInstructions", () => {
  it("labels the panel row with the agent's title, not the plumbing", () => {
    // Regression: the panel takes its label from the Bash tool's description.
    // Passing a generic one rendered every agent as "Attach to the cursor agent".
    const { attachDescription } = attachInstructions("ag_abc123", "port auth tests to vitest");
    assert.equal(attachDescription, "port auth tests to vitest");
  });

  it("builds a command naming the agent id", () => {
    const { attachCommand } = attachInstructions("ag_abc123", "port auth tests");
    assert.match(attachCommand, /attach 'ag_abc123'/);
    assert.match(attachCommand, /bin\/cursor-agents\.js/);
  });

  it("quotes a title containing shell metacharacters", () => {
    const title = "fix \"quoted\" $VAR `id`; rm -rf / it's";
    const { attachCommand } = attachInstructions("ag_x", title);
    assert.ok(attachCommand.endsWith("--title 'fix \"quoted\" $VAR `id`; rm -rf / it'\\''s'"));
  });

  it("quotes the CLI path, so a checkout under a directory with spaces still attaches", () => {
    assert.match(attachInstructions("ag_x", "t").attachCommand, /^node '[^']+bin\/cursor-agents\.js' attach /);
  });

  it("round-trips any title through a real shell", () => {
    const title = "fix \"quoted\" $VAR `id`; rm -rf / it's";
    const out = execFileSync("sh", ["-c", `printf '%s' ${shellQuote(title)}`], { encoding: "utf8" });
    assert.equal(out, title);
  });

  it("tells the caller to pass the description verbatim", () => {
    assert.match(attachInstructions("ag_x", "t").note, /attachDescription VERBATIM/);
  });
});
