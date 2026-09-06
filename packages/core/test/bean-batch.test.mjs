// Covers bean.js's bean/batch RESOLUTION rules — the find-or-create logic that
// backs the "every workflow has a bean and a bag" invariant.
//
// The rule that matters most: a batch's identity is (beanId, roastDate), NOT one
// per shot. Pulling ten shots from the same bag must reuse ONE batch, so
// resolveBatch has to find before it creates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/bean.js");
const NSXCore = window.NSXCore;

test("normalizeRoastDate truncates to the day — two bags roasted the same day are one bag", () => {
  assert.equal(NSXCore.normalizeRoastDate("2026-06-20T09:31:00Z"), "2026-06-20");
  assert.equal(NSXCore.normalizeRoastDate("2026-06-20"), "2026-06-20");
  assert.equal(NSXCore.normalizeRoastDate(null), null);
  assert.equal(NSXCore.normalizeRoastDate(undefined), null);
  assert.equal(NSXCore.normalizeRoastDate(""), null, "a bag with no date recorded is 'undated', not a date");
});

test("findBatchForRoastDate matches on the day, ignoring any time component", () => {
  const batches = [
    { id: "b1", roastDate: "2026-06-01" },
    { id: "b2", roastDate: "2026-06-20T08:00:00Z" },
  ];
  assert.equal(NSXCore.findBatchForRoastDate(batches, "2026-06-20")?.id, "b2");
  assert.equal(NSXCore.findBatchForRoastDate(batches, "2026-06-20T23:59:00Z")?.id, "b2");
  assert.equal(NSXCore.findBatchForRoastDate(batches, "2026-07-01"), null, "no bag for an unseen date");
});

test("findBatchForRoastDate resolves the single 'undated' bag when no date is set", () => {
  const batches = [{ id: "dated", roastDate: "2026-06-20" }, { id: "undated" }];
  assert.equal(NSXCore.findBatchForRoastDate(batches, null)?.id, "undated");
  assert.equal(NSXCore.findBatchForRoastDate([{ id: "dated", roastDate: "2026-06-20" }], null), null);
});

test("findBatchForRoastDate never reuses an archived bag", () => {
  const batches = [{ id: "old", roastDate: "2026-06-20", archived: true }];
  assert.equal(NSXCore.findBatchForRoastDate(batches, "2026-06-20"), null);
});

test("resolveBatch REUSES an existing bag — it does not create one per shot", async () => {
  let created = 0;
  window.NSXApi = {
    fetchBatches: async () => [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-20T00:00:00Z" }],
    createBatch: async () => { created++; return { id: "batch-new" }; },
  };

  // Same bag, three separate resolutions (i.e. three shots) — one batch, no creates.
  for (let i = 0; i < 3; i++) {
    const batch = await NSXCore.resolveBatch("bean-1", "2026-06-20");
    assert.equal(batch.id, "batch-1");
  }
  assert.equal(created, 0, "an existing bag must never be re-created");
});

test("resolveBatch creates exactly one bag when none matches, with a day-normalized date", async () => {
  const creates = [];
  window.NSXApi = {
    fetchBatches: async () => [{ id: "batch-1", roastDate: "2026-06-01" }],
    createBatch: async (beanId, payload) => { creates.push([beanId, payload]); return { id: "batch-new", ...payload }; },
  };

  const batch = await NSXCore.resolveBatch("bean-1", "2026-06-20T09:31:00Z");
  assert.equal(batch.id, "batch-new");
  assert.deepEqual(creates, [["bean-1", { roastDate: "2026-06-20" }]], "stores the day, not the timestamp");
});

test("resolveBatch creates an undated bag (no roastDate key) when no date is given", async () => {
  const creates = [];
  window.NSXApi = {
    fetchBatches: async () => [],
    createBatch: async (beanId, payload) => { creates.push(payload); return { id: "batch-new" }; },
  };

  await NSXCore.resolveBatch("bean-1", null);
  assert.deepEqual(creates, [{}], "an undated bag carries no roastDate at all");
});

test("resolveBean returns an existing bean (case-insensitive) without creating one", async () => {
  let created = 0;
  NSXCore.setBeansCache([{ id: "bean-1", roaster: "Mock Roasters", name: "Yirgacheffe" }]);
  window.NSXApi = { createBean: async () => { created++; return {}; } };

  const bean = await NSXCore.resolveBean("mock roasters", "  YIRGACHEFFE ");
  assert.equal(bean.id, "bean-1");
  assert.equal(created, 0);
});

test("resolveBean creates a missing bean so a workflow always has a real one to hang a bag off", async () => {
  const creates = [];
  NSXCore.setBeansCache([]);
  window.NSXApi = {
    createBean: async (payload) => { creates.push(payload); return { id: "bean-new", ...payload }; },
    fetchBeans: async () => [{ id: "bean-new", roaster: "New Roaster", name: "New Bean" }],
  };

  const bean = await NSXCore.resolveBean("New Roaster", "New Bean");
  assert.deepEqual(creates, [{ roaster: "New Roaster", name: "New Bean" }]);
  assert.equal(bean.id, "bean-new");
  assert.ok(NSXCore.getBeans().some((b) => b.id === "bean-new"), "the cache is refreshed so the skin sees it");
});
