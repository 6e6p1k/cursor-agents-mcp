/** @file Unit tests for inspect-side formatting helpers. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatElapsed } from "../src/tools/inspect.js";

describe("formatElapsed", () => {
  it("renders sub-minute durations in seconds", () => {
    assert.equal(formatElapsed(0), "0s");
    assert.equal(formatElapsed(4400), "4s");
  });

  it("renders minutes with zero-padded seconds", () => {
    assert.equal(formatElapsed(192_000), "3m12s");
    assert.equal(formatElapsed(125_000), "2m05s");
  });

  it("renders hours with zero-padded minutes", () => {
    assert.equal(formatElapsed(3_840_000), "1h04m");
  });

  it("clamps negative clock skew to zero", () => {
    assert.equal(formatElapsed(-5000), "0s");
  });
});
