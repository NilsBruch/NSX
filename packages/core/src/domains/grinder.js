"use strict";
/**
 * NSXCore grinder domain — headless cache + CRUD for the grinder list.
 *
 * Owns _cache (the fetched grinder list), provides load/CRUD commands, and
 * emits 'grindersLoaded' after each fetch so other UI areas can react.
 *
 * The gramsMap (dose stats per grinder model) is NSX-specific UI logic and
 * stays in the skin layer; only the raw grinder list lives here.
 *
 * Registered on NSXCore:
 *   Selectors: getGrinders()
 *   Commands:  loadGrinders(), setGrindersCache(list),
 *              createGrinder(payload), updateGrinder(id, payload),
 *              deleteGrinder(id)
 *   Event:     'grindersLoaded' -> { grinders }
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.grinder] core.js must load before domains/grinder.js");
    return;
  }

  let _cache = [];

  function getGrinders() { return _cache; }

  function setGrindersCache(list) {
    _cache = Array.isArray(list) ? list : [];
  }

  async function loadGrinders() {
    const { fetchGrinders } = window.NSXApi || {};
    if (typeof fetchGrinders !== "function") return;
    const res = await fetchGrinders();
    _cache = Array.isArray(res) ? res : (res?.items ?? []);
    NSXCore.emit("grindersLoaded", { grinders: _cache });
  }

  // CRUD wrappers — call the API and throw on error.
  // Callers are responsible for refreshing the display (loadGrinders / loadAndRenderGrinders).

  async function createGrinder(payload) {
    const { createGrinder: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.createGrinder not available");
    return api(payload);
  }

  async function updateGrinder(id, payload) {
    const { updateGrinder: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.updateGrinder not available");
    return api(id, payload);
  }

  async function deleteGrinder(id) {
    const { deleteGrinder: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.deleteGrinder not available");
    return api(id);
  }

  NSXCore.register({
    getGrinders,
    setGrindersCache,
    loadGrinders,
    createGrinder,
    updateGrinder,
    deleteGrinder,
  });
})();
