"use strict";
/**
 * NSXCore store — the shared, headless settings store.
 *
 * Owns the single `ui-settings` object that every skin persists to the gateway
 * key/value store. The object reference is STABLE: patchStore/replaceStore mutate
 * it in place so presentations can hold a long-lived alias
 * (`const store = NSXCore.getStore()`) and read from it freely.
 *
 * Persistence is debounced (300ms) and delegates to NSXApi.setStoreValue /
 * getStoreValue. Legacy localStorage settings are migrated once on startup.
 *
 * Registered on NSXCore:
 *   Selectors:  getStore()
 *   Commands:   patchStore(patch), replaceStore(data), saveActivePresetName(key, name),
 *               migrateLegacyStore(), loadStore()
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.store] core.js must load before store.js");
    return;
  }

  const STORE_NAMESPACE = "NSX";
  const STORE_KEY = "ui-settings";
  const LEGACY_STORAGE_KEYS = [
    "nsx_steam_presets",
    "nsx_steam_active_preset",
    "nsx_hotwater_presets",
    "nsx_hotwater_active_preset",
    "nsx_flush_presets",
    "nsx_flush_active_preset",
    "nsx_schedule",
  ];

  // The one stable store object. Never reassigned — only mutated in place.
  const storeSettings = {};
  let persistTimer = null;

  const api = () => window.NSXApi || {};

  function scheduleStorePersist() {
    const setStoreValue = api().setStoreValue;
    if (typeof setStoreValue !== "function") return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      setStoreValue(STORE_NAMESPACE, STORE_KEY, storeSettings)
        .catch((err) => console.debug("Store save failed:", err?.message || err));
    }, 300);
  }

  /** Merge a partial patch into the store (in place) and schedule a persist. */
  function patchStore(patch) {
    if (!patch || typeof patch !== "object") return;
    Object.assign(storeSettings, patch);
    scheduleStorePersist();
  }

  /** Replace the store's contents with `data` in place (no persist, no reassign). */
  function replaceStore(data) {
    if (!data || typeof data !== "object") return storeSettings;
    for (const key of Object.keys(storeSettings)) delete storeSettings[key];
    Object.assign(storeSettings, data);
    return storeSettings;
  }

  function saveActivePresetName(storageKey, name) {
    patchStore({ [storageKey]: name });
  }

  // ── Legacy localStorage migration ────────────────────────────────────────
  function readLegacyLocalStorageValue(key, mode = "json") {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return undefined;
      return mode === "json" ? JSON.parse(raw) : raw;
    } catch {
      return undefined;
    }
  }

  function removeLegacyLocalStorageValues() {
    try {
      for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    } catch {
      // ignore cleanup errors
    }
  }

  function collectLegacySettingsFromLocalStorage() {
    const legacy = {};

    const steamPresets = readLegacyLocalStorageValue("nsx_steam_presets", "json");
    if (steamPresets && typeof steamPresets === "object") legacy.nsx_steam_presets = steamPresets;

    const steamActive = readLegacyLocalStorageValue("nsx_steam_active_preset", "string");
    if (typeof steamActive === "string" && steamActive) legacy.nsx_steam_active_preset = steamActive;

    const hotwaterPresets = readLegacyLocalStorageValue("nsx_hotwater_presets", "json");
    if (hotwaterPresets && typeof hotwaterPresets === "object") legacy.nsx_hotwater_presets = hotwaterPresets;

    const hotwaterActive = readLegacyLocalStorageValue("nsx_hotwater_active_preset", "string");
    if (typeof hotwaterActive === "string" && hotwaterActive) legacy.nsx_hotwater_active_preset = hotwaterActive;

    const flushPresets = readLegacyLocalStorageValue("nsx_flush_presets", "json");
    if (flushPresets && typeof flushPresets === "object") legacy.nsx_flush_presets = flushPresets;

    const flushActive = readLegacyLocalStorageValue("nsx_flush_active_preset", "string");
    if (typeof flushActive === "string" && flushActive) legacy.nsx_flush_active_preset = flushActive;

    const schedule = readLegacyLocalStorageValue("nsx_schedule", "json");
    if (schedule && typeof schedule === "object") legacy.nsx_schedule = schedule;

    return legacy;
  }

  async function migrateLegacyStore() {
    const { getStoreValue, setStoreValue } = api();
    if (typeof getStoreValue !== "function" || typeof setStoreValue !== "function") return;

    const legacy = collectLegacySettingsFromLocalStorage();
    if (!Object.keys(legacy).length) return;

    try {
      let current = {};
      try {
        const storeData = await getStoreValue(STORE_NAMESPACE, STORE_KEY);
        if (storeData && typeof storeData === "object") current = storeData;
      } catch {
        // missing store key is expected on first run
      }

      const merged = Object.assign({}, legacy, current);
      await setStoreValue(STORE_NAMESPACE, STORE_KEY, merged);
      removeLegacyLocalStorageValues();
      console.debug("Legacy localStorage settings migrated to gateway store");
    } catch (err) {
      console.debug("Legacy settings migration skipped:", err?.message || err);
    }
  }

  /**
   * Load the persisted settings from the gateway into the store (in place).
   * Returns the store object on success, or null when nothing was loaded.
   */
  async function loadStore() {
    const getStoreValue = api().getStoreValue;
    if (typeof getStoreValue !== "function") return null;
    const data = await getStoreValue(STORE_NAMESPACE, STORE_KEY);
    if (!data || typeof data !== "object") return null;
    return replaceStore(data);
  }

  NSXCore.register({
    getStore: () => storeSettings,
    patchStore,
    replaceStore,
    saveActivePresetName,
    migrateLegacyStore,
    loadStore,
  });
})();
