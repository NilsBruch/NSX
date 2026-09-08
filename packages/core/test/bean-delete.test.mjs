// Covers deleteBean's cascade. The gateway does NOT remove a bean's bags for
// it: DELETE /beans/{id} on a bean that still has one fails with a raw SQLite
// foreign-key error (500). Verified on a real machine — a bean with no bags
// deletes, the same bean with one bag 500s, and deleting the bag first makes
// the bean deletable. So the ORDER here is the whole contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/bean.js");
const NSXCore = window.NSXCore;

/** Records the call order across the three endpoints deleteBean touches. */
function stubApi({ batches = [], failBatchDelete = null, failBeanDelete = false } = {}) {
  const calls = [];
  window.NSXApi = {
    fetchBatches: async (beanId, includeArchived) => {
      calls.push(`fetchBatches:${beanId}:${includeArchived}`);
      return batches;
    },
    deleteBatch: async (id) => {
      calls.push(`deleteBatch:${id}`);
      if (id === failBatchDelete) throw new Error("FOREIGN KEY constraint failed");
    },
    deleteBean: async (id) => {
      calls.push(`deleteBean:${id}`);
      if (failBeanDelete) throw new Error("FOREIGN KEY constraint failed");
      return { success: true, id };
    },
  };
  return calls;
}

test("deleteBean removes every bag BEFORE the bean", async () => {
  const calls = stubApi({ batches: [{ id: "bag1" }, { id: "bag2" }] });
  await NSXCore.deleteBean("bean1");
  assert.deepEqual(calls, [
    "fetchBatches:bean1:true",
    "deleteBatch:bag1",
    "deleteBatch:bag2",
    "deleteBean:bean1",
  ]);
});

test("deleteBean asks for ARCHIVED bags too — archiving hides a bag but keeps its foreign key", async () => {
  const calls = stubApi({ batches: [] });
  await NSXCore.deleteBean("bean1");
  assert.ok(calls[0].endsWith(":true"), `includeArchived must be true, got ${calls[0]}`);
});

test("deleteBean still deletes a bean that has no bags at all", async () => {
  const calls = stubApi({ batches: [] });
  await NSXCore.deleteBean("bean1");
  assert.deepEqual(calls, ["fetchBatches:bean1:true", "deleteBean:bean1"]);
});

test("deleteBean accepts the {items:[...]} envelope as well as a bare array", async () => {
  const calls = stubApi({ batches: { items: [{ id: "bag1" }] } });
  await NSXCore.deleteBean("bean1");
  assert.ok(calls.includes("deleteBatch:bag1"));
});

test("a bag that refuses to go does not stop the bean attempt — that attempt is what produces the real error", async () => {
  // A bag its own shots reference cannot be deleted. Pre-empting that here
  // would replace the gateway's accurate refusal with our guess at one.
  const calls = stubApi({ batches: [{ id: "bag1" }], failBatchDelete: "bag1", failBeanDelete: true });
  await assert.rejects(() => NSXCore.deleteBean("bean1"), /FOREIGN KEY/);
  assert.ok(calls.includes("deleteBean:bean1"), "the bean delete must still be attempted");
});

test("deleteBean surfaces the gateway's refusal rather than swallowing it", async () => {
  stubApi({ batches: [], failBeanDelete: true });
  await assert.rejects(() => NSXCore.deleteBean("bean1"), /FOREIGN KEY/);
});

test("deleteBean works even where the batch endpoints are missing", async () => {
  // Older bridge, or a stripped API surface: no bag clearing, but the bean
  // delete must still be tried rather than throwing on a missing function.
  const calls = [];
  window.NSXApi = { deleteBean: async (id) => { calls.push(`deleteBean:${id}`); return { success: true }; } };
  await NSXCore.deleteBean("bean1");
  assert.deepEqual(calls, ["deleteBean:bean1"]);
});
