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
 * A batch's roastDate is treated as IMMUTABLE BY THIS DOMAIN'S OWN RESOLUTION
 * PATH: resolveBatch()/findBatchForRoastDate() only ever find-or-create, and
 * callers like Nova's useRecipe.setRoastDate re-resolve to another batch
 * rather than rewriting this one — because doing so would retroactively
 * change what every past shot on that bag claims its roast date was. Note
 * this domain exposes no updateBatch/deleteBatch at all (a skin that needs
 * batch CRUD calls NSXApi's /bean-batches endpoints directly, as Nova's
 * useRecipe.js and useBeanActions.js already do), so this rule was never
 * actually enforceable from here — it's a convention every CALLER upholds,
 * not something this file's API surface can prevent.
 *
 * Nova's Diary Bags panel (a bean row's long-press menu -> "Bags") is the one
 * deliberate exception: it lets a mistyped roast date be corrected in place,
 * surfacing the retroactive-shots caveat in its own UI rather than pretending
 * the rule above has no cost.
 * Guard against creating two batches with the same (beanId, roastDate) when
 * doing this — that identity is what resolveBatch's find-or-create depends on.
 *
 * Registered on NSXCore:
 *   Selectors: getBeans(), normalizeRoastDate(v), findBatchForRoastDate(batches, roastDate),
 *              findCurrentBatch(batches)
 *   Commands:  loadBeans(includeArchived?), setBeansCache(list),
 *              createBean(payload), updateBean(id, payload), deleteBean(id),
 *              resolveBean(roaster, name), resolveBatch(beanId, roastDate),
 *              fetchCurrentBatch(beanId)
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

  /**
   * Delete a bean AND the bags hanging off it — bags first, because the
   * gateway does NOT cascade them.
   *
   * DELETE /beans/{id} on a bean that still has a batch fails with a raw
   * SQLite error, HTTP 500: `FOREIGN KEY constraint failed ... DELETE FROM
   * "beans"`. Verified against a real machine three ways: a bean with no bags
   * deletes cleanly, the same bean with one bag 500s, and removing the bag
   * first makes the bean deletable again. Both skins had assumed the bridge
   * cascaded, so "delete this bean" was broken for every bean that had ever
   * been given a roast date — which is every bean that was actually used.
   *
   * Archived bags count: archiving hides a bag from the list but leaves the
   * foreign key, so this asks for them explicitly.
   *
   * A bag its own shots still reference cannot go either, so this cannot save
   * every bean. That case is deliberately left to fail on the bean delete
   * below rather than being pre-empted here: the gateway refusing is correct
   * there, and its refusal is the thing the caller should see.
   */
  async function deleteBean(id) {
    const { deleteBean: api, fetchBatches, deleteBatch } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.deleteBean not available");

    if (id && typeof fetchBatches === "function" && typeof deleteBatch === "function") {
      try {
        const res = await fetchBatches(id, true);
        const list = Array.isArray(res) ? res : (res?.items ?? []);
        for (const batch of list) {
          if (batch?.id) await deleteBatch(batch.id);
        }
      } catch (err) {
        // Don't abort: the bean delete is still worth attempting, and if a bag
        // is what blocks it, that attempt produces the accurate error.
        console.warn("[NSXCore.bean] could not clear every bag before the bean", err?.message);
      }
    }
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
   * The bag a NEW recipe on this bean should join: the most recent DATED,
   * non-archived batch, or null when the bean has none. Pure — pass the
   * already-fetched list.
   *
   * "Most recent" is by roastDate, NOT by creation order: bags get entered
   * whenever the user gets round to it, so the newest roast is the one on the
   * counter even if an older bag was typed in after it. Undated bags never
   * win — the point of this is to hand a new recipe a date it can inherit,
   * and an undated bag has none to give.
   */
  function findCurrentBatch(batches) {
    if (!Array.isArray(batches)) return null;
    let best = null;
    let bestDate = null;
    for (const b of batches) {
      if (!b || b.archived) continue;
      const date = normalizeRoastDate(b.roastDate);
      if (!date) continue;
      // ISO 'YYYY-MM-DD' sorts lexicographically, so no Date parsing needed.
      if (bestDate === null || date > bestDate) { best = b; bestDate = date; }
    }
    return best;
  }

  /** findCurrentBatch against the gateway's current list for this bean. */
  async function fetchCurrentBatch(beanId) {
    const { fetchBatches } = window.NSXApi || {};
    if (!beanId || typeof fetchBatches !== "function") return null;
    const res = await fetchBatches(beanId, false);
    return findCurrentBatch(Array.isArray(res) ? res : (res?.items ?? []));
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
    findCurrentBatch,
    fetchCurrentBatch,
    resolveBean,
    resolveBatch,
  });
})();
