/** @file Unit tests for the background-task bridge instructions. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachInstructions } from "../src/tools/spawn.js";

describe("attachInstructions", () => {
  it("labels the panel row with the agent's title, not the plumbing", () => {
    // Regression: the panel takes its label from the Bash tool's description.
    // Passing a generic one rendered every agent as "Attach to the cursor agent".
    const { attachDescription } = attachInstructions("ag_abc123", "port auth tests to vitest");
    assert.equal(attachDescription, "port auth tests to vitest");
  });

  it("builds a command naming the agent id", () => {
    const { attachCommand } = attachInstructions("ag_abc123", "port auth tests");
    assert.match(attachCommand, /attach ag_abc123/);
    assert.match(attachCommand, /bin\/cursor-agents\.js/);
  });

  it("quotes a title containing shell metacharacters", () => {
    const { attachCommand } = attachInstructions("ag_x", 'fix "quoted" $VAR; rm -rf /');
    assert.ok(attachCommand.includes('"fix \\"quoted\\" $VAR; rm -rf /"'));
  });

  it("tells the caller to pass the description verbatim", () => {
    assert.match(attachInstructions("ag_x", "t").note, /attachDescription VERBATIM/);
  });
});
