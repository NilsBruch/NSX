"use strict";
/**
 * NSXCore bean domain — headless cache + CRUD for the bean list, plus the
 * bean/batch RESOLUTION rules (find-or-create) that a workflow depends on.
 *
 * Owns _cache (the fetched bean list, always incl. archived so that
 * autocomplete suggestions cover all beans). The skin layer handles all
 * filter / search / UI state on top of this flat cache.
 *
 * ── Batches ────────────────────────────────────────────────────────────────
 * A batch is one *bag* of a bean: its identity is (beanId, roastDate), NOT one
 * per shot. Every shot pulled from the same bag reuses the same batch, so
 * resolveBatch() is find-or-create, never blind-create. The batch is also the
 * only structural link a shot has back to its bean
 * (shot.workflow.context.beanBatchId -> batch.beanId -> bean) — without one, a
 * skin can only guess via roaster/name string matching.
 *
 * A batch's roastDate is treated as IMMUTABLE: changing the roast date means a
 * different bag, so callers re-resolve to another batch rather than rewriting
 * this one (which would retroactively change what every past shot on that bag
 * claims its roast date was).
 *
 * Registered on NSXCore:
 *   Selectors: getBeans(), normalizeRoastDate(v), findBatchForRoastDate(batches, roastDate)
 *   Commands:  loadBeans(includeArchived?), setBeansCache(list),
 *              createBean(payload), updateBean(id, payload), deleteBean(id),
 *              resolveBean(roaster, name), resolveBatch(beanId, roastDate)
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

  // ── Bean / batch resolution ────────────────────────────────────────────────

  const sameText = (a, b) =>
    String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

  /**
   * Day-granular roast date, e.g. "2026-06-20T00:00:00Z" -> "2026-06-20".
   * The gateway returns roast dates in mixed shapes; two bags roasted the same
   * day are the same bag, so comparison must ignore any time component.
   * Falsy (a bag with no roast date recorded) normalizes to null.
   */
  function normalizeRoastDate(value) {
    if (!value) return null;
    return String(value).slice(0, 10);
  }

  /**
   * The batch representing the bag roasted on `roastDate` (pure — pass the
   * already-fetched list). A null roastDate matches the bean's single "undated"
   * batch, so a bean the user never set a date for still has exactly one bag
   * rather than a new one per shot. Archived bags are never reused.
   */
  function findBatchForRoastDate(batches, roastDate) {
    if (!Array.isArray(batches)) return null;
    const target = normalizeRoastDate(roastDate);
    return batches.find(
      (b) => !b?.archived && normalizeRoastDate(b?.roastDate) === target
    ) ?? null;
  }

  /**
   * Find-or-create the bean with this roaster+name (case-insensitive). A
   * workflow can reference a coffee that was never entered in the skin's own
   * bean list (brewed in another skin, or the gateway's workflow on first
   * launch) — creating it keeps "every workflow has a real bean" true instead
   * of leaving the shot's bean link to string matching.
   */
  async function resolveBean(roaster, name) {
    const existing = _cache.find((b) => sameText(b?.roaster, roaster) && sameText(b?.name, name));
    if (existing) return existing;

    const created = await createBean({ roaster: String(roaster ?? "").trim(), name: String(name ?? "").trim() });
    await loadBeans(); // keep the cache (and any skin mirroring it) in step
    // Prefer the freshly-cached copy — the POST response may be a partial record.
    return _cache.find((b) => b?.id === created?.id) ?? created;
  }

  /**
   * Find-or-create the bag of `beanId` roasted on `roastDate`. This is what
   * stops a new batch being created per shot: the same (bean, date) always
   * resolves to the same batch.
   */
  async function resolveBatch(beanId, roastDate) {
    const { fetchBatches, createBatch } = window.NSXApi || {};
    if (typeof fetchBatches !== "function" || typeof createBatch !== "function") {
      throw new Error("NSXApi.fetchBatches/createBatch not available");
    }
    if (!beanId) throw new Error("resolveBatch needs a beanId");

    const res = await fetchBatches(beanId, false);
    const list = Array.isArray(res) ? res : (res?.items ?? []);
    const existing = findBatchForRoastDate(list, roastDate);
    if (existing) return existing;

    const date = normalizeRoastDate(roastDate);
    return createBatch(beanId, date ? { roastDate: date } : {});
  }

  NSXCore.register({
    getBeans,
    setBeansCache,
    loadBeans,
    createBean,
    updateBean,
    deleteBean,
    normalizeRoastDate,
    findBatchForRoastDate,
    resolveBean,
    resolveBatch,
  });
})();
