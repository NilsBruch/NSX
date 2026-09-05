// Covers the plugins domain: plugin list cache + per-plugin settings cache
// (keyed by plugin id, since a settings screen shows one plugin's detail at a time).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/plugins.js");
const NSXCore = window.NSXCore;

test("loadPlugins populates the cache and emits pluginsLoaded", async () => {
  const list = [{ id: "visualizer.reaplugin", loaded: false }];
  window.NSXApi = { fetchPlugins: async () => list };
  let emitted = null;
  NSXCore.on("pluginsLoaded", (p) => { emitted = p; });

  const result = await NSXCore.loadPlugins();

  assert.equal(result, list);
  assert.deepEqual(emitted, { plugins: list });
});

test("setPluginEnabled updates the cached plugin's loaded flag after the call succeeds", async () => {
  window.NSXApi = {
    fetchPlugins: async () => [{ id: "visualizer.reaplugin", loaded: false }],
    setPluginEnabled: async () => {},
  };
  await NSXCore.loadPlugins();

  await NSXCore.setPluginEnabled("visualizer.reaplugin", true);

  assert.equal(NSXCore.getPlugins()[0].loaded, true);
});

test("loadPluginSettings caches per plugin id, and savePluginSetting merges optimistically", async () => {
  let sentPayload = null;
  window.NSXApi = {
    fetchPluginSettings: async () => ({ username: "", autoUpload: false }),
    updatePluginSettings: async (id, payload) => { sentPayload = [id, payload]; },
  };

  await NSXCore.loadPluginSettings("visualizer.reaplugin");
  await NSXCore.savePluginSetting("visualizer.reaplugin", "autoUpload", true);

  assert.deepEqual(sentPayload, ["visualizer.reaplugin", { autoUpload: true }]);
  const cached = NSXCore.getPluginSettings("visualizer.reaplugin");
  assert.equal(cached.autoUpload, true);
  assert.equal(cached.username, "", "unrelated keys are untouched");
});

test("getPluginSettings returns an empty object for an id that was never loaded", () => {
  assert.deepEqual(NSXCore.getPluginSettings("never-loaded"), {});
});
