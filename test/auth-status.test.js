/** @file Unit tests for the status-line auth-expiry warning. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authExpiryWarning } from "../src/auth-status.js";

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("authExpiryWarning", () => {
  it("returns null when the key is far from expiry", () => {
    assert.equal(
      authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: NOW + 90 * DAY_MS }, NOW),
      null,
    );
  });

  it("warns when the key expires within 14 days", () => {
    assert.equal(
      authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: NOW + 7 * DAY_MS }, NOW),
      "⚠ SDK key expires in 7d",
    );
    assert.equal(
      authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: NOW + 14 * DAY_MS }, NOW),
      "⚠ SDK key expires in 14d",
    );
    assert.equal(
      authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: NOW + 14 * DAY_MS + 1 }, NOW),
      null,
    );
  });

  it("warns when the key has already expired", () => {
    assert.equal(
      authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: NOW - 1 }, NOW),
      "⚠ SDK key expired",
    );
  });

  it("warns when the SDK reports logged-out", () => {
    assert.equal(authExpiryWarning({ status: "logged-out" }, NOW), "⚠ SDK logged out");
  });

  it("returns null when apiKeyExpiresAtMs is missing or malformed", () => {
    assert.equal(authExpiryWarning({ status: "logged-in" }, NOW), null);
    assert.equal(authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: "soon" }, NOW), null);
    assert.equal(authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: NaN }, NOW), null);
    assert.equal(authExpiryWarning({ status: "logged-in", apiKeyExpiresAtMs: Infinity }, NOW), null);
  });
});
