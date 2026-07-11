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
  // Settings used to live in one opaque "ui-settings" blob. That made every
  // write a full-blob replace, so a stale tab writing any single field (e.g.
  // nsx_last_recipe_id as a side effect of selecting a recipe) silently
  // clobbered fields another tab had just changed (issue #3 follow-up). Each
  // setting is now its own KV key in the NSX namespace, so a write only ever
  // touches the field it changed. All settings keys are "nsx_"-prefixed, which
  // distinguishes them from the namespace's other keys (recipes,
  // profile-favorites) when reading the whole namespace back.
  const LEGACY_BLOB_KEY = "ui-settings";
  const SETTINGS_PREFIX = "nsx_";
  const isSettingKey = (k) => typeof k === "string" && k.startsWith(SETTINGS_PREFIX);
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
  // Keys changed since the last flush — only these get written, one KV key each.
  const pendingKeys = new Set();
  let persistTimer = null;

  const api = () => window.NSXApi || {};

  function scheduleStorePersist() {
    const setStoreValue = api().setStoreValue;
    if (typeof setStoreValue !== "function") return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const keys = [...pendingKeys];
      pendingKeys.clear();
      for (const key of keys) {
        Promise.resolve(setStoreValue(STORE_NAMESPACE, key, storeSettings[key]))
          .catch((err) => console.debug("Store save failed:", key, err?.message || err));
      }
    }, 300);
  }

  /** Merge a partial patch into the store (in place) and schedule a persist. */
  function patchStore(patch) {
    if (!patch || typeof patch !== "object") return;
    for (const [key, value] of Object.entries(patch)) {
      storeSettings[key] = value;
      pendingKeys.add(key);
    }
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

  // Only the settings (nsx_*) fields of an object — never recipes /
  // profile-favorites, which live under their own keys in the namespace.
  function pickSettings(obj) {
    const out = {};
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) if (isSettingKey(k)) out[k] = v;
    }
    return out;
  }

  /**
   * One-time migration to the per-field key layout:
   *   1. fold in legacy localStorage settings (older format), then
   *   2. split any remaining single "ui-settings" blob into per-field keys, and
   *   3. delete the blob so it can't shadow future reads.
   * Idempotent: a no-op once nothing legacy remains.
   */
  async function migrateLegacyStore() {
    const { getStoreValue, setStoreValue, deleteStoreValue } = api();
    if (typeof getStoreValue !== "function" || typeof setStoreValue !== "function") return;

    try {
      let blob = null;
      try {
        const stored = await getStoreValue(STORE_NAMESPACE, LEGACY_BLOB_KEY);
        if (stored && typeof stored === "object") blob = stored;
      } catch {
        // missing blob is expected once migrated / on first run
      }

      const legacy = collectLegacySettingsFromLocalStorage();
      // Blob wins over localStorage for the same key (it's the newer format).
      const merged = Object.assign({}, legacy, pickSettings(blob || {}));
      if (!Object.keys(merged).length) {
        removeLegacyLocalStorageValues();
        return;
      }

      for (const [key, value] of Object.entries(merged)) {
        await setStoreValue(STORE_NAMESPACE, key, value);
      }
      if (blob && typeof deleteStoreValue === "function") {
        try { await deleteStoreValue(STORE_NAMESPACE, LEGACY_BLOB_KEY); } catch { /* best-effort */ }
      }
      removeLegacyLocalStorageValues();
      console.debug("Store migrated to per-field keys");
    } catch (err) {
      console.debug("Store layout migration skipped:", err?.message || err);
    }
  }

  /**
   * Load the persisted settings from the gateway into the store (in place).
   * Reads the whole namespace (ETag-backed ?full=1) and keeps only the nsx_*
   * settings keys. Falls back to the legacy single blob if the namespace read
   * is unavailable. Returns the store object on success, or null.
   */
  async function loadStore() {
    const { getStoreNamespace, getStoreValue } = api();

    let ns = null;
    if (typeof getStoreNamespace === "function") {
      try { ns = await getStoreNamespace(STORE_NAMESPACE); } catch { ns = null; }
    }

    if (ns && typeof ns === "object") {
      // Legacy blob (if a pre-migration write still exists) forms the base;
      // per-field nsx_* keys win over it.
      const merged = Object.assign({}, pickSettings(ns[LEGACY_BLOB_KEY] || {}), pickSettings(ns));
      if (!Object.keys(merged).length) return null;
      return replaceStore(merged);
    }

    // Fallback: no namespace endpoint — read the legacy blob directly.
    if (typeof getStoreValue === "function") {
      const data = await getStoreValue(STORE_NAMESPACE, LEGACY_BLOB_KEY).catch(() => null);
      if (data && typeof data === "object") return replaceStore(pickSettings(data));
    }
    return null;
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
