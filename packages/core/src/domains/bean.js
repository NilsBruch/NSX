"use strict";
/**
 * NSXCore bean domain — headless cache + CRUD for the bean list.
 *
 * Owns _cache (the fetched bean list, always incl. archived so that
 * autocomplete suggestions cover all beans). The skin layer handles all
 * filter / search / UI state on top of this flat cache.
 *
 * Registered on NSXCore:
 *   Selectors: getBeans()
 *   Commands:  loadBeans(includeArchived?), setBeansCache(list),
 *              createBean(payload), updateBean(id, payload), deleteBean(id)
 *   Event:     'beansLoaded' -> { beans }
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.bean] core.js must load before domains/bean.js");
    return;
  }

  let _cache = [];

  function getBeans() { return _cache; }

  function setBeansCache(list) {
    _cache = Array.isArray(list) ? list : [];
  }

  async function loadBeans(includeArchived = true) {
    const { fetchBeans } = window.NSXApi || {};
    if (typeof fetchBeans !== "function") return;
    const data = await fetchBeans(includeArchived);
    _cache = Array.isArray(data) ? data : (data?.items ?? []);
    NSXCore.emit("beansLoaded", { beans: _cache });
  }

  // CRUD wrappers — call the API and throw on error.
  // Callers handle toast messages and triggering a list reload.

  async function createBean(payload) {
    const { createBean: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.createBean not available");
    return api(payload);
  }

  async function updateBean(id, payload) {
    const { updateBean: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.updateBean not available");
    return api(id, payload);
  }

  async function deleteBean(id) {
    const { deleteBean: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.deleteBean not available");
    return api(id);
  }

  NSXCore.register({
    getBeans,
    setBeansCache,
    loadBeans,
    createBean,
    updateBean,
    deleteBean,
  });
})();
