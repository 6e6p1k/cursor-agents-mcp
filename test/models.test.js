/** @file Unit tests for model selection and the fast-tier guard. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateCostUsd,
  modelFamily,
  normaliseModelId,
  requestsFastTier,
  resolveModel,
} from "../src/models.js";

describe("normaliseModelId", () => {
  it("strips the cursor- prefix and effort/fast suffixes", () => {
    assert.equal(normaliseModelId("cursor-grok-4.6-high"), "grok-4.6");
    assert.equal(normaliseModelId("cursor-grok-4.6-xhigh-fast"), "grok-4.6");
    assert.equal(normaliseModelId("cursor-grok-4.5-high-fast"), "grok-4.5");
  });

  it("leaves an already-canonical id untouched", () => {
    assert.equal(normaliseModelId("grok-4.6"), "grok-4.6");
  });
});

describe("requestsFastTier", () => {
  it("detects the fast suffix", () => {
    assert.equal(requestsFastTier("cursor-grok-4.5-high-fast"), true);
    assert.equal(requestsFastTier("grok-4.6"), false);
  });
});

describe("resolveModel", () => {
  it("defaults to grok-4.6 at high effort with fast disabled", () => {
    const model = resolveModel();
    assert.equal(model.id, "grok-4.6");
    assert.deepEqual(model.params, [
      { id: "effort", value: "high" },
      { id: "fast", value: "false" },
    ]);
  });

  it("always pins fast explicitly, because Cursor defaults it to true", () => {
    const fastParam = resolveModel({ effort: "low" }).params.find((p) => p.id === "fast");
    assert.equal(fastParam?.value, "false");
  });

  it("opts in to the fast tier only when asked", () => {
    const fastParam = resolveModel({ allowFast: true }).params.find((p) => p.id === "fast");
    assert.equal(fastParam?.value, "true");
  });

  it("normalises a CLI-style id into the SDK namespace", () => {
    assert.equal(resolveModel({ model: "cursor-grok-4.5-high" }).id, "grok-4.5");
  });

  it("rejects an effort the model does not offer", () => {
    assert.throws(() => resolveModel({ model: "grok-4.5", effort: "xhigh" }), /does not offer effort/);
  });

  it("accepts xhigh for grok-4.6", () => {
    assert.equal(resolveModel({ model: "grok-4.6", effort: "xhigh" }).params[0].value, "xhigh");
  });
});

describe("estimateCostUsd", () => {
  it("bills cached reads at the lower rate and excludes them from fresh input", () => {
    // 1M input of which 0.5M cached, 0.1M output:
    // 0.5M * $2 + 0.5M * $0.50 + 0.1M * $6 = $1.00 + $0.25 + $0.60
    const usd = estimateCostUsd("grok-4.6", {
      inputTokens: 1_000_000,
      cacheReadTokens: 500_000,
      outputTokens: 100_000,
    });
    assert.equal(Number(usd.toFixed(4)), 1.85);
  });

  it("prices 4.5 and 4.6 identically", () => {
    const usage = { inputTokens: 1000, outputTokens: 100 };
    assert.equal(estimateCostUsd("grok-4.5", usage), estimateCostUsd("grok-4.6", usage));
  });

  it("returns null rather than a wrong number for an unpriced model", () => {
    // Regression: the cost column previously read a totalCents field the SDK
    // never returns, so it silently never rendered.
    assert.equal(estimateCostUsd("composer-2.5", { inputTokens: 1000 }), null);
    assert.equal(estimateCostUsd(undefined, { inputTokens: 1000 }), null);
  });

  it("returns null when no usage was reported", () => {
    assert.equal(estimateCostUsd("grok-4.6", undefined), null);
    assert.equal(estimateCostUsd("grok-4.6", {}), null);
  });

  it("treats cached reads exceeding input as zero fresh input", () => {
    const usd = estimateCostUsd("grok-4.6", { inputTokens: 100, cacheReadTokens: 500 });
    assert.equal(Number(usd.toFixed(6)), 0.00025);
  });
});

describe("modelFamily", () => {
  it("takes the vendor segment before the version", () => {
    assert.equal(modelFamily("grok-4.6"), "grok");
    assert.equal(modelFamily("claude-opus-5"), "claude");
    assert.equal(modelFamily("gpt-5.3-codex"), "gpt");
  });

  it("returns null for a missing id", () => {
    assert.equal(modelFamily(undefined), null);
    assert.equal(modelFamily(""), null);
  });
});
