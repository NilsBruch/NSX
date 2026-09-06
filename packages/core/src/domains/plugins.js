"use strict";
/**
 * NSXCore plugins domain — headless cache + enable/disable + per-plugin settings
 * (e.g. the Visualizer integration: username/password, auto-upload, …).
 *
 * Per-plugin settings are cached by plugin id since a settings screen typically
 * shows one plugin's detail at a time; the plugin list itself is a flat cache.
 *
 * Registered on NSXCore:
 *   Selectors: getPlugins(), getPluginSettings(id)
 *   Commands:  loadPlugins(), setPluginEnabled(id, enabled),
 *              loadPluginSettings(id), savePluginSetting(id, key, value)
 *   Event:     'pluginsLoaded' -> { plugins }
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.plugins] core.js must load before domains/plugins.js");
    return;
  }

  let _cache = [];
  const _settingsCache = new Map(); // pluginId -> settings object

  function getPlugins() { return _cache; }
  function getPluginSettings(id) { return _settingsCache.get(id) || {}; }

  async function loadPlugins() {
    const { fetchPlugins } = window.NSXApi || {};
    if (typeof fetchPlugins !== "function") return _cache;
    const res = await fetchPlugins();
    _cache = Array.isArray(res) ? res : (res?.items ?? []);
    NSXCore.emit("pluginsLoaded", { plugins: _cache });
    return _cache;
  }

  async function setPluginEnabled(id, enabled) {
    const { setPluginEnabled: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.setPluginEnabled not available");
    await api(id, enabled);
    const plugin = _cache.find((p) => (p.id ?? p.pluginId) === id);
    if (plugin) plugin.loaded = enabled;
  }

  async function loadPluginSettings(id) {
    const { fetchPluginSettings } = window.NSXApi || {};
    if (typeof fetchPluginSettings !== "function") return {};
    const settings = (await fetchPluginSettings(id)) || {};
    _settingsCache.set(id, settings);
    return settings;
  }

  async function savePluginSetting(id, key, value) {
    const current = _settingsCache.get(id) || {};
    _settingsCache.set(id, { ...current, [key]: value });
    const { updatePluginSettings } = window.NSXApi || {};
    if (typeof updatePluginSettings !== "function") throw new Error("NSXApi.updatePluginSettings not available");
    return updatePluginSettings(id, { [key]: value });
  }

  NSXCore.register({
    getPlugins,
    getPluginSettings,
    loadPlugins,
    setPluginEnabled,
    loadPluginSettings,
    savePluginSetting,
  });
})();
