// Covers the per-field store layout that replaced the single ui-settings blob
// (issue #3 follow-up): a write must only touch the field it changed, so a
// stale tab can't clobber another tab's unrelated setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("store.js");
const NSXCore = window.NSXCore;
const flush = () => new Promise((r) => setTimeout(r, 350)); // wait out the 300ms debounce

test("patchStore writes only the changed key — not a whole blob", async () => {
  const writes = [];
  window.NSXApi = { setStoreValue: async (ns, key, val) => { writes.push([ns, key, val]); } };

  NSXCore.patchStore({ nsx_steam_presets: { hot: 1 } });
  await flush();
  assert.deepEqual(writes, [["NSX", "nsx_steam_presets", { hot: 1 }]]);

  // A later, unrelated write (the clobber trigger: nsx_last_recipe_id) must not
  // re-send nsx_steam_presets.
  writes.length = 0;
  NSXCore.patchStore({ nsx_last_recipe_id: "r1" });
  await flush();
  assert.deepEqual(writes, [["NSX", "nsx_last_recipe_id", "r1"]]);
});

test("loadStore reads the namespace and keeps only nsx_ settings keys", async () => {
  window.NSXApi = {
    getStoreNamespace: async () => ({
      recipes: [{ id: "r1" }],
      "profile-favorites": ["p1"],
      nsx_steam_presets: { hot: 1 },
      nsx_sbw_enabled: true,
    }),
  };
  const store = await NSXCore.loadStore();
  assert.deepEqual(Object.keys(store).sort(), ["nsx_sbw_enabled", "nsx_steam_presets"]);
  assert.equal(store.recipes, undefined, "recipes/favorites are not folded into settings");
});

test("loadStore folds a lingering legacy blob but lets per-field keys win", async () => {
  window.NSXApi = {
    getStoreNamespace: async () => ({
      "ui-settings": { nsx_steam_presets: { hot: 0 }, nsx_water_unit: "ml" },
      nsx_steam_presets: { hot: 9 }, // per-field key overrides the blob copy
    }),
  };
  const store = await NSXCore.loadStore();
  assert.deepEqual(store.nsx_steam_presets, { hot: 9 }, "per-field key wins over blob");
  assert.equal(store.nsx_water_unit, "ml", "blob-only field still loaded");
});

test("migrateLegacyStore splits the blob into per-field keys and deletes it", async () => {
  const writes = [];
  let deletedKey = null;
  window.NSXApi = {
    getStoreValue: async (_ns, key) =>
      key === "ui-settings"
        ? { nsx_steam_presets: { hot: 1 }, nsx_sbw_enabled: true, recipes: "ignore-me" }
        : null,
    setStoreValue: async (_ns, key, val) => { writes.push([key, val]); },
    deleteStoreValue: async (_ns, key) => { deletedKey = key; },
  };

  await NSXCore.migrateLegacyStore();

  assert.deepEqual(writes.map((w) => w[0]).sort(), ["nsx_sbw_enabled", "nsx_steam_presets"]);
  assert.equal(writes.find((w) => w[0] === "recipes"), undefined, "non-settings keys are not split out");
  assert.equal(deletedKey, "ui-settings", "the old blob is removed after splitting");
});
