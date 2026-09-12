/** @file Unit tests for environment-driven configuration. */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { resolveModel } from "../src/models.js";
import { authExpiryWarning } from "../src/auth-status.js";

const VARS = [
  "CURSOR_AGENTS_MODEL", "CURSOR_AGENTS_EFFORT", "CURSOR_AGENTS_SANDBOX",
  "CURSOR_AGENTS_ALLOW_FAST", "CURSOR_AGENTS_SETTING_SOURCES", "CURSOR_AGENTS_KEY_WARN_DAYS",
];

afterEach(() => {
  for (const name of VARS) delete process.env[name];
});

describe("loadConfig defaults", () => {
  it("ships the documented defaults when nothing is set", () => {
    assert.deepEqual(loadConfig(), {
      model: "grok-4.6",
      effort: "high",
      sandbox: false,
      allowFast: false,
      settingSources: ["project", "user", "plugins"],
      keyWarnDays: 14,
    });
  });
});

describe("loadConfig overrides", () => {
  it("reads strings, ignoring surrounding whitespace", () => {
    process.env.CURSOR_AGENTS_MODEL = "  grok-4.5  ";
    assert.equal(loadConfig().model, "grok-4.5");
  });

  it("accepts several spellings of true", () => {
    for (const value of ["1", "true", "YES", "on"]) {
      process.env.CURSOR_AGENTS_SANDBOX = value;
      assert.equal(loadConfig().sandbox, true, `${value} should be truthy`);
    }
  });

  it("fails closed on an unrecognised boolean, rather than enabling it", () => {
    process.env.CURSOR_AGENTS_ALLOW_FAST = "maybe";
    assert.equal(loadConfig().allowFast, false);
  });

  it("splits and trims a list", () => {
    process.env.CURSOR_AGENTS_SETTING_SOURCES = "project , user ,, ";
    assert.deepEqual(loadConfig().settingSources, ["project", "user"]);
  });

  it("falls back when a value is empty or unparseable", () => {
    process.env.CURSOR_AGENTS_MODEL = "   ";
    process.env.CURSOR_AGENTS_KEY_WARN_DAYS = "soon";
    assert.equal(loadConfig().model, "grok-4.6");
    assert.equal(loadConfig().keyWarnDays, 14);
  });

  it("rejects a non-positive warn window", () => {
    process.env.CURSOR_AGENTS_KEY_WARN_DAYS = "0";
    assert.equal(loadConfig().keyWarnDays, 14);
  });
});

describe("configuration reaches its consumers", () => {
  it("changes the default model and effort used by resolveModel", () => {
    process.env.CURSOR_AGENTS_MODEL = "grok-4.5";
    process.env.CURSOR_AGENTS_EFFORT = "low";
    const model = resolveModel({});
    assert.equal(model.id, "grok-4.5");
    assert.equal(model.params[0].value, "low");
  });

  it("still pins fast false by default, whatever the model", () => {
    process.env.CURSOR_AGENTS_MODEL = "grok-4.5";
    assert.equal(resolveModel({}).params[1].value, "false");
  });

  it("widens the key warning window when asked", () => {
    const now = 1_700_000_000_000;
    const in20Days = now + 20 * 24 * 60 * 60 * 1000;
    const auth = { status: "logged-in", apiKeyExpiresAtMs: in20Days };
    assert.equal(authExpiryWarning(auth, now), null);
    assert.equal(authExpiryWarning(auth, now, 30), "⚠ SDK key expires in 20d");
  });
});
