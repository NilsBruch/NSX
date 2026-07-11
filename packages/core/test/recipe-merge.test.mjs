// Covers the recipes 3-way merge (base / ours / theirs) that stops concurrent
// writes on different devices from clobbering each other (issue #3 follow-up).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/workflow.js");
const NSXCore = window.NSXCore;
const ids = (list) => list.map((r) => r.id).sort();

test("two devices adding different recipes union instead of clobbering", () => {
  const base = [{ id: "r1" }];
  const ours = [{ id: "r1" }, { id: "rA" }];   // we added rA
  const theirs = [{ id: "r1" }, { id: "rB" }]; // another device added rB
  assert.deepEqual(ids(NSXCore.mergeRecipes(base, ours, theirs)), ["r1", "rA", "rB"]);
});

test("a delete sticks even if the server copy still has the recipe", () => {
  const base = [{ id: "r1" }, { id: "r2" }];
  const ours = [{ id: "r1" }];                 // we deleted r2
  const theirs = [{ id: "r1" }, { id: "r2" }]; // server still has r2
  assert.deepEqual(ids(NSXCore.mergeRecipes(base, ours, theirs)), ["r1"]);
});

test("our edit wins over the server copy for the same id", () => {
  const base = [{ id: "r1", grind: 10 }];
  const ours = [{ id: "r1", grind: 12 }];
  const theirs = [{ id: "r1", grind: 10 }];
  const out = NSXCore.mergeRecipes(base, ours, theirs);
  assert.equal(out.find((r) => r.id === "r1").grind, 12);
});

test("a recipe added by another device is preserved (not seen as deleted)", () => {
  const base = [{ id: "r1" }];
  const ours = [{ id: "r1" }];                 // we changed nothing structural
  const theirs = [{ id: "r1" }, { id: "rB" }]; // rB appeared server-side
  assert.deepEqual(ids(NSXCore.mergeRecipes(base, ours, theirs)), ["r1", "rB"]);
});

test("saveRecipes merges against the live server list before writing", async () => {
  let written = null;
  window.NSXApi = {
    getStoreNamespace: async () => ({ recipes: [{ id: "r1" }, { id: "rB" }] }), // server gained rB
    setStoreValue: async (_ns, _key, value) => { written = value; },
  };

  // Prime the base: we loaded [r1] earlier.
  window.NSXApi.getStoreNamespace = async () => ({ recipes: [{ id: "r1" }] });
  await NSXCore.loadRecipes(true);

  // Now the server has gained rB from another device; we save our local edit.
  window.NSXApi.getStoreNamespace = async () => ({ recipes: [{ id: "r1" }, { id: "rB" }] });
  const result = await NSXCore.saveRecipes([{ id: "r1", grind: 12 }]);

  assert.deepEqual(ids(written), ["r1", "rB"], "server's rB survives our write");
  assert.equal(written.find((r) => r.id === "r1").grind, 12, "our edit is applied");
  assert.deepEqual(ids(result), ["r1", "rB"]);
});
