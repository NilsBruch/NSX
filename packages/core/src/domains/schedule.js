"use strict";
/**
 * NSXCore schedule domain — headless state + gateway sync for the machine on/off schedule.
 *
 * Owns scheduleState (enabled, days, onHour/Minute, offHour/Minute, scheduleId),
 * persists through the core store, and syncs to the gateway schedule API.
 *
 * Registered on NSXCore:
 *   Selectors: getScheduleState()
 *   Commands:  applySchedule(patch), setScheduleId(id), hydrateSchedule(),
 *              syncScheduleToApi()
 *   Event:     'scheduleChanged' -> state snapshot
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.schedule] core.js must load before domains/schedule.js");
    return;
  }

  const DEFAULTS = {
    enabled: false,
    days: [1, 2, 3, 4, 5],
    onHour: 6, onMinute: 0,
    offHour: 22, offMinute: 0,
    scheduleId: null,
  };

  const state = Object.assign({}, DEFAULTS);

  function pad2(n) { return String(n).padStart(2, "0"); }

  /**
   * The gateway schedule is wake-only: it fires (wakes the machine) at `time`
   * and `keepAwakeFor` holds it awake for that many minutes afterwards, which
   * is how the sleep time reaches the machine. We map keepAwakeFor to the
   * awake window = (offTime - onTime).
   *
   * Caveats worth knowing:
   *  - The field maxes at 720 (12h), so a longer awake window is capped there.
   *  - keepAwakeFor only SUSPENDS the idle auto-sleep for its duration; once it
   *    elapses the machine falls back to that timeout (userPresenceEnabled +
   *    sleepTimeoutMinutes), so the machine actually sleeps a bit AFTER offTime,
   *    not exactly at it. Trying to hit offTime exactly (diff - sleepTimeout)
   *    would be fragile — it assumes auto-sleep is on and the machine idle.
   *  - offTime == onTime is degenerate -> wake-only (null).
   */
  function computeKeepAwakeFor() {
    const onMin = state.onHour * 60 + state.onMinute;
    const offMin = state.offHour * 60 + state.offMinute;
    const diff = (((offMin - onMin) % 1440) + 1440) % 1440;
    if (diff <= 0) return null;
    return Math.max(1, Math.min(720, diff));
  }

  function emitChanged() {
    NSXCore.emit("scheduleChanged", Object.assign({}, state));
  }

  /** Patch state, persist to store, emit, then sync to the gateway API. */
  function applySchedule(patch) {
    if (patch && typeof patch === "object") Object.assign(state, patch);
    NSXCore.patchStore({ nsx_schedule: Object.assign({}, state) });
    emitChanged();
    syncScheduleToApi();
  }

  /** Update only the stored schedule ID (set after creating/loading from the API). */
  function setScheduleId(id) {
    state.scheduleId = id ?? null;
    NSXCore.patchStore({ nsx_schedule: Object.assign({}, state) });
  }

  function hydrateSchedule() {
    const s = NSXCore.getStore();
    if (s.nsx_schedule && typeof s.nsx_schedule === "object") {
      Object.assign(state, DEFAULTS, s.nsx_schedule);
    }
    // Emit so reactive subscribers (e.g. Nova's scheduleState, created at import
    // time with DEFAULTS before the store loaded) refresh to the persisted state
    // — otherwise the enabled toggle / days silently reset on reload.
    emitChanged();
  }

  async function syncScheduleToApi() {
    const { updateSchedule, createSchedule } = window.NSXApi || {};
    const t = window.NSXI18n?.t || ((k) => k);

    if (!state.enabled) {
      if (state.scheduleId && typeof updateSchedule === "function") {
        try {
          await updateSchedule(state.scheduleId, { id: state.scheduleId, enabled: false });
        } catch {}
      }
      return;
    }

    const days = state.days.length > 0 ? state.days : [1, 2, 3, 4, 5, 6, 7];
    const time = `${pad2(state.onHour)}:${pad2(state.onMinute)}`;
    const keepAwakeFor = computeKeepAwakeFor();

    if (state.scheduleId && typeof updateSchedule === "function") {
      try {
        await updateSchedule(state.scheduleId, {
          id: state.scheduleId,
          time,
          daysOfWeek: days,
          enabled: true,
          keepAwakeFor,
        });
        return;
      } catch {
        state.scheduleId = null;
        NSXCore.patchStore({ nsx_schedule: Object.assign({}, state) });
      }
    }

    if (typeof createSchedule !== "function") return;
    try {
      const created = await createSchedule({
        time,
        daysOfWeek: days,
        enabled: true,
        keepAwakeFor,
      });
      state.scheduleId = created?.id || null;
      NSXCore.patchStore({ nsx_schedule: Object.assign({}, state) });
    } catch (err) {
      NSXCore.emit("toast", t("toast.scheduleFailed") + ": " + err.message);
    }
  }

  NSXCore.register({
    getScheduleState: () => Object.assign({}, state),
    applySchedule,
    setScheduleId,
    hydrateSchedule,
    syncScheduleToApi,
  });
})();
