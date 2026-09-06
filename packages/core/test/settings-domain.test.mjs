// Covers the settings domain: three independent caches (app/machine/advanced),
// each loaded and saved independently, with an optimistic local merge on save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/settings.js");
const NSXCore = window.NSXCore;

test("loadAppSettings populates the app cache and emits settingsLoaded", async () => {
  window.NSXApi = { fetchSettings: async () => ({ chargingMode: "balanced" }) };
  let emitted = null;
  NSXCore.on("settingsLoaded", (p) => { emitted = p; });

  const result = await NSXCore.loadAppSettings();

  assert.deepEqual(result, { chargingMode: "balanced" });
  assert.deepEqual(NSXCore.getAppSettings(), { chargingMode: "balanced" });
  assert.deepEqual(emitted.app, { chargingMode: "balanced" });
});

test("saveAppSetting merges optimistically before the gateway call resolves", async () => {
  let sentPayload = null;
  window.NSXApi = {
    fetchSettings: async () => ({ chargingMode: "balanced", logLevel: "INFO" }),
    updateReaSettings: async (payload) => { sentPayload = payload; },
  };
  await NSXCore.loadAppSettings();

  await NSXCore.saveAppSetting("logLevel", "WARNING");

  assert.deepEqual(sentPayload, { logLevel: "WARNING" }, "only the changed key is sent");
  assert.equal(NSXCore.getAppSettings().logLevel, "WARNING", "local cache reflects the new value");
  assert.equal(NSXCore.getAppSettings().chargingMode, "balanced", "unrelated keys are untouched");
});

test("machine and advanced settings are independent caches", async () => {
  window.NSXApi = {
    fetchMachineSettings: async () => ({ usb: true }),
    fetchMachineSettingsAdvanced: async () => ({ heaterIdleTemp: 90 }),
  };

  await NSXCore.loadMachineSettings();
  await NSXCore.loadAdvancedSettings();

  assert.deepEqual(NSXCore.getMachineSettings(), { usb: true });
  assert.deepEqual(NSXCore.getAdvancedSettings(), { heaterIdleTemp: 90 });
});

test("saveMachineSetting throws a clear error when NSXApi lacks the method", async () => {
  window.NSXApi = {};
  await assert.rejects(
    () => NSXCore.saveMachineSetting("usb", true),
    /updateMachineSettings not available/
  );
});
