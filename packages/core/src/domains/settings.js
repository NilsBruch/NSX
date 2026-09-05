"use strict";
/**
 * NSXCore settings domain — headless cache for the gateway/app + machine settings.
 *
 * Three separate gateway resources, kept as three separate caches (they are
 * fetched, saved, and reasoned about independently — merging them would just
 * make callers destructure a bigger object for no gain):
 *   - "app"      /api/v1/settings                  (charging mode, night mode,
 *                                                    gateway mode, log level, …)
 *   - "machine"  /api/v1/machine/settings           (USB charger mode, …)
 *   - "advanced" /api/v1/machine/settings/advanced  (flow/heater calibration)
 *
 * Each save is optimistic (merge into the local cache immediately) then fires
 * the request — same pattern NSX's settings.js used ad hoc per-skin; here it
 * is shared so Nova gets it for free.
 *
 * Registered on NSXCore:
 *   Selectors: getAppSettings(), getMachineSettings(), getAdvancedSettings()
 *   Commands:  loadAppSettings(), loadMachineSettings(), loadAdvancedSettings(),
 *              saveAppSetting(key, value), saveMachineSetting(key, value),
 *              saveAdvancedSetting(key, value)
 *   Event:     'settingsLoaded' -> { app, machine, advanced }
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.settings] core.js must load before domains/settings.js");
    return;
  }

  let _app = {};
  let _machine = {};
  let _advanced = {};

  function getAppSettings() { return _app; }
  function getMachineSettings() { return _machine; }
  function getAdvancedSettings() { return _advanced; }

  async function loadAppSettings() {
    const { fetchSettings } = window.NSXApi || {};
    if (typeof fetchSettings !== "function") return _app;
    _app = (await fetchSettings()) || {};
    NSXCore.emit("settingsLoaded", { app: _app, machine: _machine, advanced: _advanced });
    return _app;
  }

  async function loadMachineSettings() {
    const { fetchMachineSettings } = window.NSXApi || {};
    if (typeof fetchMachineSettings !== "function") return _machine;
    _machine = (await fetchMachineSettings()) || {};
    NSXCore.emit("settingsLoaded", { app: _app, machine: _machine, advanced: _advanced });
    return _machine;
  }

  async function loadAdvancedSettings() {
    const { fetchMachineSettingsAdvanced } = window.NSXApi || {};
    if (typeof fetchMachineSettingsAdvanced !== "function") return _advanced;
    _advanced = (await fetchMachineSettingsAdvanced()) || {};
    NSXCore.emit("settingsLoaded", { app: _app, machine: _machine, advanced: _advanced });
    return _advanced;
  }

  async function saveAppSetting(key, value) {
    _app = { ..._app, [key]: value };
    const { updateReaSettings } = window.NSXApi || {};
    if (typeof updateReaSettings !== "function") throw new Error("NSXApi.updateReaSettings not available");
    return updateReaSettings({ [key]: value });
  }

  async function saveMachineSetting(key, value) {
    _machine = { ..._machine, [key]: value };
    const { updateMachineSettings } = window.NSXApi || {};
    if (typeof updateMachineSettings !== "function") throw new Error("NSXApi.updateMachineSettings not available");
    return updateMachineSettings({ [key]: value });
  }

  async function saveAdvancedSetting(key, value) {
    _advanced = { ..._advanced, [key]: value };
    const { updateMachineSettingsAdvanced } = window.NSXApi || {};
    if (typeof updateMachineSettingsAdvanced !== "function") throw new Error("NSXApi.updateMachineSettingsAdvanced not available");
    return updateMachineSettingsAdvanced({ [key]: value });
  }

  NSXCore.register({
    getAppSettings,
    getMachineSettings,
    getAdvancedSettings,
    loadAppSettings,
    loadMachineSettings,
    loadAdvancedSettings,
    saveAppSetting,
    saveMachineSetting,
    saveAdvancedSetting,
  });
})();
