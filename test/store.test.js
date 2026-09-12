/** @file Unit tests for the on-disk agent record store. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

let store;
let paths;
let root;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "cursor-agents-test-"));
  process.env.CURSOR_AGENTS_STATE_ROOT = root;
  store = await import("../src/store.js");
  paths = await import("../src/paths.js");
});

after(() => rmSync(root, { recursive: true, force: true }));

/**
 * Creates a record with sensible defaults for tests.
 *
 * @param {string} id Agent id to create.
 * @param {object} [overrides] Fields merged over the default metadata.
 * @returns {Promise<void>} Resolves once the record exists.
 */
async function seed(id, overrides = {}) {
  await store.createRecord(id, {
    id,
    title: `title ${id}`,
    cwd: "/repo",
    sessionId: "s1",
    createdAt: Date.now(),
    ...overrides,
  });
}

describe("newAgentId", () => {
  it("produces distinct prefixed ids", () => {
    const a = paths.newAgentId();
    assert.match(a, /^ag_[a-z0-9]{6}$/);
    assert.notEqual(a, paths.newAgentId());
  });
});

describe("createRecord", () => {
  it("writes meta and an initial starting status", async () => {
    await seed("ag_aaa");
    assert.equal((await store.readMeta("ag_aaa")).title, "title ag_aaa");
    assert.equal((await store.readStatus("ag_aaa")).state, "starting");
  });
});

describe("readMeta", () => {
  it("returns null for an unknown agent rather than throwing", async () => {
    assert.equal(await store.readMeta("ag_nope"), null);
    assert.equal(await store.readStatus("ag_nope"), null);
  });
});

describe("patchStatus", () => {
  it("merges fields and preserves untouched ones", async () => {
    await seed("ag_bbb");
    await store.patchStatus("ag_bbb", { state: "running", runId: "r1" });
    await store.patchStatus("ag_bbb", { lastActivity: "edit a.js" });
    const status = await store.readStatus("ag_bbb");
    assert.equal(status.state, "running");
    assert.equal(status.runId, "r1");
    assert.equal(status.lastActivity, "edit a.js");
  });
});

describe("readLines", () => {
  it("returns only entries newer than the given cursor", async () => {
    await seed("ag_ccc");
    for (const seq of [1, 2, 3]) {
      await store.appendLine("ag_ccc", "digest", { seq, kind: "tool", text: `t${seq}` });
    }
    assert.equal((await store.readLines("ag_ccc", "digest", 0)).length, 3);
    const tail = await store.readLines("ag_ccc", "digest", 2);
    assert.deepEqual(tail.map((e) => e.text), ["t3"]);
  });

  it("returns empty for a log that does not exist yet", async () => {
    await seed("ag_ddd");
    assert.deepEqual(await store.readLines("ag_ddd", "digest", 0), []);
  });
});

describe("listRecords", () => {
  it("filters by session, cwd and activity", async () => {
    await seed("ag_e1", { sessionId: "sA", cwd: "/one" });
    await seed("ag_e2", { sessionId: "sB", cwd: "/two" });
    await store.patchStatus("ag_e2", { state: "finished" });

    const bySession = await store.listRecords({ sessionId: "sA" });
    assert.deepEqual(bySession.map((r) => r.id), ["ag_e1"]);

    const byCwd = await store.listRecords({ cwd: "/two" });
    assert.deepEqual(byCwd.map((r) => r.id), ["ag_e2"]);

    const active = await store.listRecords({ activeOnly: true });
    assert.ok(!active.some((r) => r.id === "ag_e2"));
  });

  it("orders newest first", async () => {
    await seed("ag_old", { createdAt: 1000 });
    await seed("ag_new", { createdAt: 2000 });
    const ids = (await store.listRecords({})).map((r) => r.id);
    assert.ok(ids.indexOf("ag_new") < ids.indexOf("ag_old"));
  });
});

describe("latestSeq", () => {
  it("returns the highest sequence present", () => {
    assert.equal(store.latestSeq([{ seq: 3 }, { seq: 9 }, { seq: 4 }]), 9);
  });

  it("returns 0 for an empty log, so a fresh reader starts at the beginning", () => {
    assert.equal(store.latestSeq([]), 0);
  });

  it("tolerates entries without a seq", () => {
    assert.equal(store.latestSeq([{}, { seq: 2 }]), 2);
  });

  it("skips a control log written by an earlier turn", async () => {
    // Regression: a runner starting at seq 0 replayed the previous turn's
    // cancel, so resuming a cancelled agent ended instantly.
    await seed("ag_ctl");
    await store.appendLine("ag_ctl", "control", { seq: 100, op: "cancel" });
    const resumeCursor = store.latestSeq(await store.readLines("ag_ctl", "control", 0));
    assert.equal((await store.readLines("ag_ctl", "control", resumeCursor)).length, 0);

    await store.appendLine("ag_ctl", "control", { seq: 200, op: "steer", text: "hi" });
    const fresh = await store.readLines("ag_ctl", "control", resumeCursor);
    assert.deepEqual(fresh.map((e) => e.op), ["steer"]);
  });
});

describe("writeResult", () => {
  it("round-trips the final text and returns null before it exists", async () => {
    await seed("ag_fff");
    assert.equal(await store.readResult("ag_fff"), null);
    await store.writeResult("ag_fff", "done");
    assert.equal(await store.readResult("ag_fff"), "done");
  });
});
