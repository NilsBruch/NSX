"use strict";
/**
 * NSXCore steam domain — headless state + logic for the steam wand.
 *
 * Owns steamPresets / activeSteamPreset / steamTemp / steamFlow / steamDuration /
 * steamEnabled, plus steamCalibration and pitcherPresets (used by Steam-by-Weight).
 * Persists through the core store; pushes steamSettings to the machine.
 *
 * Registered on NSXCore:
 *   Selectors: getSteamTemp(), getSteamFlow(), getSteamDuration(), getSteamPresets(),
 *              getActiveSteamPreset(), isSteamEnabled(), getSteamCalibration(),
 *              getPitcherPresets(), getActivePitcherIndex(), getSbwCalibFactor()
 *   Commands:  selectSteamPreset(name), deactivateSteamPreset(),
 *              setSteamTemp(v), setSteamFlow(v), setSteamDuration(v),
 *              setSteamDurationRaw(v),   ← SBW override: no deactivate, no push
 *              setSteamEnabled(enabled), setSteamPresets(next),
 *              setSteamCalibration(calib), setPitcherPresets(next),
 *              setActivePitcher(idx), applySteamSnapshot(snap), hydrateSteam()
 *   Events:    'steamChanged'   -> { temp, flow, duration, active, presets, enabled }
 *              'pitcherChanged' -> { pitcherPresets, activePitcherIndex }
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.steam] core.js must load before domains/steam.js");
    return;
  }

  const PRESET_DEFAULTS = {
    schwach: { name: "Weak",   temp: 165, flow: 0.6, duration: 60, calibFactor: null },
    normal:  { name: "Normal", temp: 165, flow: 1.0, duration: 60, calibFactor: null },
    stark:   { name: "Strong", temp: 165, flow: 1.5, duration: 60, calibFactor: null },
  };

  const CALIB_DEFAULTS = {
    schwach: { milkWeight: null, steamingTime: null },
    normal:  { milkWeight: null, steamingTime: null },
    stark:   { milkWeight: null, steamingTime: null },
  };

  const PITCHER_DEFAULTS = [
    { name: "Pitcher 1", steamPreset: "normal", pitcherWeight: null },
    { name: "Pitcher 2", steamPreset: "normal", pitcherWeight: null },
    { name: "Pitcher 3", steamPreset: "normal", pitcherWeight: null },
  ];

  let presets           = JSON.parse(JSON.stringify(PRESET_DEFAULTS));
  let active            = "normal";
  let temp              = presets[active].temp;
  let flow              = presets[active].flow;
  let duration          = presets[active].duration ?? 60;
  let enabled           = true;
  let calibration       = JSON.parse(JSON.stringify(CALIB_DEFAULTS));
  let pitcherPresets    = PITCHER_DEFAULTS.map(p => ({ ...p }));
  let activePitcherIndex = 0;

  const clampTemp     = (v) => Math.min(165, Math.max(100, v));
  const clampFlow     = (v) => Math.round(Math.min(4.0, Math.max(0.5, v)) * 10) / 10;
  const clampDuration = (v) => Math.min(180, Math.max(1, v));

  function emitChanged() {
    NSXCore.emit("steamChanged", { temp, flow, duration, active, presets, enabled });
  }

  function emitPitcherChanged() {
    NSXCore.emit("pitcherChanged", { pitcherPresets, activePitcherIndex });
  }

  // ── Push helpers ─────────────────────────────────────────────────────────
  function pushAll() {
    NSXCore.debounced("steam", () =>
      NSXCore.push({ steamSettings: { targetTemperature: parseFloat(temp), flow: parseFloat(flow), duration: parseFloat(duration) } }));
  }
  function pushTemp() {
    NSXCore.debounced("steamTemp", () =>
      NSXCore.push({ steamSettings: { targetTemperature: parseFloat(temp) } }));
  }
  function pushFlow() {
    NSXCore.debounced("steamFlow", () =>
      NSXCore.push({ steamSettings: { flow: parseFloat(flow) } }));
  }
  function pushDuration() {
    NSXCore.debounced("steamDuration", () =>
      NSXCore.push({ steamSettings: { duration: parseFloat(duration) } }));
  }
  function pushEnabled() {
    const pushSteamSettings = (window.NSXApi || {}).pushSteamSettings;
    if (typeof pushSteamSettings !== "function") return;
    if (enabled) {
      pushSteamSettings(temp, flow).catch(() => {});
    } else {
      pushSteamSettings(0, 0).catch(() => {});
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────
  function selectSteamPreset(name) {
    if (!presets[name]) return;
    active   = name;
    temp     = presets[name].temp;
    flow     = presets[name].flow;
    duration = presets[name].duration ?? 60;
    NSXCore.saveActivePresetName("nsx_steam_active_preset", name);
    emitChanged();
    pushAll();
  }

  function deactivateSteamPreset() {
    active = null;
    NSXCore.saveActivePresetName("nsx_steam_active_preset", "");
    emitChanged();
  }

  function setSteamTemp(v) {
    temp = clampTemp(v);
    active = null;
    NSXCore.saveActivePresetName("nsx_steam_active_preset", "");
    emitChanged();
    pushTemp();
  }

  function setSteamFlow(v) {
    flow = clampFlow(v);
    active = null;
    NSXCore.saveActivePresetName("nsx_steam_active_preset", "");
    emitChanged();
    pushFlow();
  }

  function setSteamDuration(v) {
    duration = clampDuration(v);
    active = null;
    NSXCore.saveActivePresetName("nsx_steam_active_preset", "");
    emitChanged();
    pushDuration();
  }

  // Does NOT deactivate the active preset and does NOT push — for SBW override.
  function setSteamDurationRaw(v) {
    duration = Math.max(1, Math.round(v));
    emitChanged();
  }

  function setSteamEnabled(en) {
    enabled = Boolean(en);
    NSXCore.patchStore({ nsx_steam_enabled: enabled });
    emitChanged();
    pushEnabled();
  }

  function setSteamPresets(next) {
    if (!next || typeof next !== "object") return;
    presets = next;
    NSXCore.patchStore({ nsx_steam_presets: presets });
    if (active && presets[active]) {
      temp     = presets[active].temp;
      flow     = presets[active].flow;
      duration = presets[active].duration ?? 60;
      pushAll();
    }
    emitChanged();
  }

  function setSteamCalibration(calib) {
    if (!calib || typeof calib !== "object") return;
    calibration = calib;
    NSXCore.patchStore({ nsx_steam_calibration: calibration });
    // Bake calibFactors into presets.
    Object.entries(calibration).forEach(([key, c]) => {
      if (presets[key] && c.milkWeight > 0 && c.steamingTime > 0) {
        presets[key].calibFactor = c.steamingTime / c.milkWeight;
      }
    });
    NSXCore.patchStore({ nsx_steam_presets: presets });
    emitChanged();
    emitPitcherChanged();
  }

  function setPitcherPresets(next) {
    if (!Array.isArray(next)) return;
    pitcherPresets = next;
    NSXCore.patchStore({ nsx_pitcher_presets: pitcherPresets });
    emitPitcherChanged();
  }

  function setActivePitcher(idx) {
    activePitcherIndex = idx;
    const setStoreValue = (window.NSXApi || {}).setStoreValue;
    setStoreValue?.("skin", "nsx_active_pitcher", idx).catch(() => {});
    emitPitcherChanged();
  }

  /** Snapshot the current steam state — used by SBW for save/restore. */
  function saveSteamSnapshot() {
    return { preset: active, temp, flow, duration };
  }

  /** Restore a snapshot created by saveSteamSnapshot(), then push. */
  function applySteamSnapshot(snap) {
    if (!snap) return;
    active   = snap.preset ?? null;
    temp     = snap.temp   ?? temp;
    flow     = snap.flow   ?? flow;
    duration = snap.duration ?? duration;
    NSXCore.saveActivePresetName("nsx_steam_active_preset", active ?? "");
    emitChanged();
    pushAll();
  }

  function getSbwCalibFactor() {
    const pitcher = pitcherPresets[activePitcherIndex];
    if (!pitcher?.steamPreset) return null;
    return presets[pitcher.steamPreset]?.calibFactor ?? null;
  }

  // ── Hydration ─────────────────────────────────────────────────────────────
  function hydrateSteam() {
    const s = NSXCore.getStore();

    if (s.nsx_steam_presets && typeof s.nsx_steam_presets === "object") {
      presets = {
        schwach: { ...PRESET_DEFAULTS.schwach, ...s.nsx_steam_presets.schwach },
        normal:  { ...PRESET_DEFAULTS.normal,  ...s.nsx_steam_presets.normal  },
        stark:   { ...PRESET_DEFAULTS.stark,   ...s.nsx_steam_presets.stark   },
      };
    }
    const savedActive = s.nsx_steam_active_preset;
    if (typeof savedActive === "string" && presets[savedActive]) active = savedActive;
    else if (savedActive === "" || savedActive === null) active = null;

    if (s.nsx_steam_calibration && typeof s.nsx_steam_calibration === "object") {
      calibration = {
        schwach: { ...CALIB_DEFAULTS.schwach, ...s.nsx_steam_calibration.schwach },
        normal:  { ...CALIB_DEFAULTS.normal,  ...s.nsx_steam_calibration.normal  },
        stark:   { ...CALIB_DEFAULTS.stark,   ...s.nsx_steam_calibration.stark   },
      };
    }

    if (Array.isArray(s.nsx_pitcher_presets)) {
      pitcherPresets = s.nsx_pitcher_presets.map((p, i) => ({
        ...PITCHER_DEFAULTS[i],
        ...p,
      })).slice(0, 3);
      while (pitcherPresets.length < 3) pitcherPresets.push({ ...PITCHER_DEFAULTS[pitcherPresets.length] });
    }

    if (typeof s.nsx_active_pitcher === "number" &&
        s.nsx_active_pitcher >= 0 && s.nsx_active_pitcher <= 2) {
      activePitcherIndex = s.nsx_active_pitcher;
    }

    if (typeof s.nsx_steam_enabled === "boolean") enabled = s.nsx_steam_enabled;

    const state = presets[active] ?? presets.normal;
    temp     = state.temp;
    flow     = state.flow;
    duration = state.duration ?? 60;
  }

  NSXCore.register({
    // Selectors
    getSteamTemp:           () => temp,
    getSteamFlow:           () => flow,
    getSteamDuration:       () => duration,
    getSteamPresets:        () => presets,
    getActiveSteamPreset:   () => active,
    isSteamEnabled:         () => enabled,
    getSteamCalibration:    () => calibration,
    getPitcherPresets:      () => pitcherPresets,
    getActivePitcherIndex:  () => activePitcherIndex,
    getSbwCalibFactor,
    // Commands
    selectSteamPreset,
    deactivateSteamPreset,
    setSteamTemp,
    setSteamFlow,
    setSteamDuration,
    setSteamDurationRaw,
    setSteamEnabled,
    setSteamPresets,
    setSteamCalibration,
    setPitcherPresets,
    setActivePitcher,
    saveSteamSnapshot,
    applySteamSnapshot,
    hydrateSteam,
    // Expose defaults for drafts in the settings modals (read-only reference)
    STEAM_PRESET_DEFAULTS:  PRESET_DEFAULTS,
    STEAM_CALIB_DEFAULTS:   CALIB_DEFAULTS,
    PITCHER_PRESET_DEFAULTS: PITCHER_DEFAULTS,
  });
})();
