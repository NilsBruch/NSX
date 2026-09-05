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

test("loadStore keeps both nsx_ and nova_ settings keys, drops non-settings keys", async () => {
  window.NSXApi = {
    getStoreNamespace: async () => ({
      recipes: [{ id: "r1" }],
      "profile-favorites": ["p1"],
      nsx_steam_presets: { hot: 1 },
      nsx_sbw_enabled: true,
      // Nova's skin settings — must survive the round-trip too, else they'd be
      // written to the gateway but revert to defaults on every reload.
      nova_start_tab: "diary",
      nova_wakelock: false,
    }),
  };
  const store = await NSXCore.loadStore();
  assert.deepEqual(
    Object.keys(store).sort(),
    ["nova_start_tab", "nova_wakelock", "nsx_sbw_enabled", "nsx_steam_presets"],
  );
  assert.equal(store.nova_start_tab, "diary", "nova_ skin settings survive loadStore");
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

test("getStoreNamespace defaults to NSX", () => {
  assert.equal(NSXCore.getStoreNamespace(), "NSX");
});

test("setStoreNamespace changes which namespace patchStore writes to", async () => {
  const writes = [];
  window.NSXApi = { setStoreValue: async (ns, key, val) => { writes.push([ns, key, val]); } };

  NSXCore.setStoreNamespace("Nova");
  try {
    NSXCore.patchStore({ nsx_display_brightness: 80 });
    await flush();
    assert.deepEqual(writes, [["Nova", "nsx_display_brightness", 80]], "a second skin's writes land in ITS namespace, not NSX's");
  } finally {
    NSXCore.setStoreNamespace("NSX"); // restore the default so it can't leak into other tests in this file
  }
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
