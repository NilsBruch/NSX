// Covers the deduped, ETag-backed NSX store-namespace cache (recipes +
// profile-favorites share ONE fetch) and loadRecipes deriving from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/workflow.js");
const NSXCore = window.NSXCore;

test("loadNsxNamespace dedups (cache without force) and loadRecipes derives recipes", async () => {
  const ns = { recipes: [{ id: "r1" }], "profile-favorites": ["p1"] };
  let calls = 0;
  window.NSXApi = { getStoreNamespace: async () => { calls++; return ns; } };

  const first = await NSXCore.loadNsxNamespace();
  const cached = await NSXCore.loadNsxNamespace(); // no force → served from cache
  assert.equal(calls, 1, "second load without force does not re-fetch");
  assert.equal(cached, first);

  const recipes = await NSXCore.loadRecipes();
  assert.equal(recipes, ns.recipes, "recipes returned by reference from the shared namespace");
});

test("loadNsxNamespace keeps the cache reference stable on a 304 (same payload)", async () => {
  const ns = { recipes: [{ id: "r1" }] };
  window.NSXApi = { getStoreNamespace: async () => ns }; // same ref = 304

  const a = await NSXCore.loadNsxNamespace(true);
  const b = await NSXCore.loadNsxNamespace(true);
  assert.equal(b, a, "unchanged payload keeps the cached dict reference");
});

test("loadNsxNamespace rebuilds on change; invalidate clears the cache", async () => {
  const ns1 = { recipes: [{ id: "r1" }] };
  const ns2 = { recipes: [{ id: "r1" }, { id: "r2" }] };
  let current = ns1;
  window.NSXApi = { getStoreNamespace: async () => current };

  const a = await NSXCore.loadNsxNamespace(true);
  current = ns2;
  const b = await NSXCore.loadNsxNamespace(true);
  assert.notEqual(b, a, "changed payload yields a new dict reference");
  assert.equal((await NSXCore.loadRecipes()).length, 2);

  NSXCore.invalidateNsxNamespace();
  assert.equal(NSXCore.getNsxNamespace(), null, "cache is cleared after invalidate");
});
