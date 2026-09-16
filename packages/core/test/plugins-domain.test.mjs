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

/* ── The schema a settings screen renders from ───────────────────────────── */

const VIZ = {
  id: "visualizer.reaplugin",
  settings: {
    Username: { type: "string", label: "Visualizer username", description: "Visualiser username" },
    Password: { type: "string", label: "Visualizer password", secure: true },
    AutoUpload: { type: "boolean", label: "Upload shots automatically", default: true },
    LengthThreshold: { type: "number", label: "Minimum shot length", default: 5 },
  },
};

test("getPluginSchema lists the fields in order, with the key as the fallback label", () => {
  const fields = NSXCore.getPluginSchema(VIZ);
  assert.deepEqual(fields.map((f) => f.key), ["Username", "Password", "AutoUpload", "LengthThreshold"]);
  assert.equal(fields[1].secure, true);
  assert.equal(fields[2].default, true);
  assert.equal(fields[0].label, "Visualizer username");

  const unlabelled = NSXCore.getPluginSchema({ settings: { Stabilisation: { type: "number" } } });
  assert.equal(unlabelled[0].label, "Stabilisation", "a control without a label still needs a name");
  assert.equal(unlabelled[0].type, "number");
});

test("a plugin with no settings has nothing to render, not a broken page", () => {
  assert.deepEqual(NSXCore.getPluginSchema({ id: "dye2.reaplugin", settings: {} }), []);
  assert.deepEqual(NSXCore.getPluginSchema({ id: "x" }), []);
  assert.deepEqual(NSXCore.getPluginSchema(null), []);
});

test("isPluginSecretSet reads all three shapes a gateway answers with", () => {
  assert.equal(NSXCore.isPluginSecretSet({ Password: { isSet: true } }, "Password"), true, "redacted");
  assert.equal(NSXCore.isPluginSecretSet({ Password: { isSet: false } }, "Password"), false);
  assert.equal(NSXCore.isPluginSecretSet({ Password: "hunter2" }, "Password"), true, "older gateway");
  assert.equal(NSXCore.isPluginSecretSet({ Password: "" }, "Password"), false);
  assert.equal(NSXCore.isPluginSecretSet({ secretsSet: { Password: true } }, "Password"), true, "envelope");
  assert.equal(NSXCore.isPluginSecretSet({}, "Password"), false);
});

test("pluginSettingValue falls back to the schema default, and never surfaces a secret", () => {
  const [user, pass, auto, len] = NSXCore.getPluginSchema(VIZ);
  const values = { Username: "nils", Password: { isSet: true }, AutoUpload: false };
  assert.equal(NSXCore.pluginSettingValue(values, user), "nils");
  assert.equal(NSXCore.pluginSettingValue(values, auto), false, "a stored false is a value, not a miss");
  assert.equal(NSXCore.pluginSettingValue(values, len), 5, "unset -> the schema's default");
  assert.equal(NSXCore.pluginSettingValue(values, pass), undefined, "a redacted secret is not a value");
});
