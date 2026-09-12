/** @file Unit tests for stream-message digesting. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeArgs, digestMessage, relativise, renderDigest, textEntry, truncate } from "../src/digest.js";

describe("truncate", () => {
  it("collapses whitespace onto one line", () => {
    assert.equal(truncate("a\n  b\tc"), "a b c");
  });

  it("marks text it shortened", () => {
    assert.equal(truncate("abcdef", 4), "abc…");
  });
});

describe("relativise", () => {
  it("shortens a path inside the working directory", () => {
    assert.equal(relativise("/repo/src/auth.ts", "/repo"), "src/auth.ts");
  });

  it("leaves paths outside the working directory absolute", () => {
    assert.equal(relativise("/elsewhere/x.ts", "/repo"), "/elsewhere/x.ts");
  });

  it("passes through non-paths and a missing cwd", () => {
    assert.equal(relativise("src/x.ts", "/repo"), "src/x.ts");
    assert.equal(relativise("/repo/x.ts", undefined), "/repo/x.ts");
  });
});

describe("describeArgs", () => {
  it("prefers a file path over other keys", () => {
    assert.equal(describeArgs({ command: "ls", path: "/repo/a.js" }, "/repo"), "a.js");
  });

  it("falls back to a command or query", () => {
    assert.equal(describeArgs({ command: "pytest -q" }), "pytest -q");
    assert.equal(describeArgs({ query: "auth flow" }), "auth flow");
  });

  it("returns empty for unrecognised shapes", () => {
    assert.equal(describeArgs({ weird: 1 }), "");
    assert.equal(describeArgs(null), "");
  });
});

describe("digestMessage", () => {
  it("summarises a completed tool call with a relative path", () => {
    const entry = digestMessage(
      { type: "tool_call", status: "completed", name: "edit", args: { path: "/repo/src/a.js" } },
      "/repo",
    );
    assert.deepEqual(entry, { kind: "tool", text: "edit src/a.js" });
  });

  it("marks a failed tool call", () => {
    const entry = digestMessage({ type: "tool_call", status: "error", name: "shell", args: {} }, "/repo");
    assert.equal(entry?.text, "shell [failed]");
  });

  it("skips a still-running tool call, since its completion follows", () => {
    assert.equal(digestMessage({ type: "tool_call", status: "running", name: "edit" }), null);
  });

  it("ignores assistant deltas, which the runner coalesces", () => {
    const msg = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } };
    assert.equal(digestMessage(msg), null);
  });

  it("keeps explained status messages but drops bare lifecycle ones", () => {
    assert.equal(digestMessage({ type: "status", status: "RUNNING" }), null);
    assert.deepEqual(digestMessage({ type: "status", status: "ERROR", message: "quota hit" }), {
      kind: "status",
      text: "quota hit",
    });
  });

  it("ignores thinking and unknown message types", () => {
    assert.equal(digestMessage({ type: "thinking", text: "hmm" }), null);
    assert.equal(digestMessage({ type: "nope" }), null);
    assert.equal(digestMessage(null), null);
  });
});

describe("textEntry", () => {
  it("builds one entry from accumulated deltas", () => {
    assert.deepEqual(textEntry("I'll fix it."), { kind: "text", text: "I'll fix it." });
  });

  it("returns null for blank buffers", () => {
    assert.equal(textEntry("   \n "), null);
  });
});

describe("renderDigest", () => {
  it("marks each kind distinctly", () => {
    const out = renderDigest([
      { kind: "text", text: "plan" },
      { kind: "tool", text: "edit a.js" },
      { kind: "status", text: "retrying" },
    ]);
    assert.equal(out, "» plan\n— edit a.js\n· retrying");
  });

  it("reports an empty digest rather than an empty string", () => {
    assert.equal(renderDigest([]), "(no activity yet)");
  });
});
