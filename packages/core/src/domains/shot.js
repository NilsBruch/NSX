"use strict";
/**
 * NSXCore shot domain — headless per-shot detail cache + CRUD.
 *
 * Owns _cache (Map<shotId, fullShotDetails>), the fetch-or-cache lookup, and
 * CRUD wrappers. Unlike grinder/bean there is no single canonical "shot list"
 * — app.js keeps its own list state (shots/historyShots) for the different
 * views (live, history, workflow nav) and syncs annotations/metadata back
 * into those arrays itself after a cache read.
 *
 * Registered on NSXCore:
 *   Selectors: getCachedShotDetails(id) — sync, cache-only, no fetch
 *   Commands:  getShotDetails(id) — fetch-or-cache, returns Promise<shot>
 *              fetchShotsForWorkflow(workflow, {limit}) — this recipe's whole
 *                history, queried server-side (not filtered out of a recent
 *                window), returns Promise<shot[]> newest-first
 *              invalidateShotDetails(id)
 *              deleteShot(id), updateShot(id, patch),
 *              updateShotWorkflowContext(id, ctxPatch), updateShotMeta(id, patch)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.shot] core.js must load before domains/shot.js");
    return;
  }

  const _cache = new Map();

  function getCachedShotDetails(id) {
    return _cache.get(id) ?? null;
  }

  function invalidateShotDetails(id) {
    _cache.delete(id);
  }

  async function getShotDetails(id) {
    if (!id) throw new Error("Invalid shot id");
    if (_cache.has(id)) return _cache.get(id);
    const { fetchShotDetails } = window.NSXApi || {};
    if (typeof fetchShotDetails !== "function") throw new Error("NSXApi.fetchShotDetails not available");
    const fullShot = await fetchShotDetails(id);
    _cache.set(id, fullShot);
    return fullShot;
  }

  /**
   * Every stored shot for ONE recipe, newest first — asked of the GATEWAY
   * rather than filtered out of a skin's recent-shots list.
   *
   * findShotsForWorkflow() can only see the shots it is handed, and a skin
   * hands it a fixed recent window (Nova: the newest 200). A recipe last
   * brewed further back than that window reaches therefore looked as if it
   * had never been brewed at all — no graph, "no shot found" — although its
   * shots were sitting in the gateway the whole time. The shot list endpoint
   * filters server-side on exactly the four fields the workflow key is built
   * from, so the query can be scoped to this bean + grinder + profile and
   * come back complete regardless of how old the shots are.
   *
   * The server's filters match EXACTLY (case-sensitive) while the workflow
   * key is case-normalized, so the result is still narrowed through
   * findShotsForWorkflow — that also keeps the sort and the "—" placeholder
   * semantics identical to the in-memory path. A placeholder value is never
   * sent as a filter: "—" means "unset", not a coffee literally named that.
   */
  async function fetchShotsForWorkflow(workflow, { limit = 200 } = {}) {
    const { fetchShots } = window.NSXApi || {};
    if (typeof fetchShots !== "function") throw new Error("NSXApi.fetchShots not available");
    if (!workflow) return [];

    const filters = { limit, offset: 0 };
    const addFilter = (key, value) => {
      const text = String(value ?? "").trim();
      if (text && text !== "—") filters[key] = text;
    };
    addFilter("coffeeRoaster", workflow.coffeeRoaster);
    addFilter("coffeeName", workflow.coffeeName);
    addFilter("grinderModel", workflow.grinderModel);
    addFilter("profileTitle", workflow.profileTitle);

    const res = await fetchShots(filters);
    const items = Array.isArray(res) ? res : (res?.items ?? []);
    // mapping.js loads after this domain, so the selector is read at call
    // time rather than captured at module scope.
    return NSXCore.findShotsForWorkflow(workflow, items);
  }

  // CRUD wrappers — call the API, invalidate the cache entry so the next
  // getShotDetails() refetches fresh data, and throw on error.

  async function deleteShot(id) {
    const { deleteShotById: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.deleteShotById not available");
    await api(id);
    invalidateShotDetails(id);
  }

  async function updateShot(id, patch) {
    const { updateShotRecord: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.updateShotRecord not available");
    const result = await api(id, patch);
    invalidateShotDetails(id);
    return result;
  }

  /**
   * Patch fields of a stored shot's WORKFLOW CONTEXT (the recipe as it was at
   * brew time: grinder setting, roaster/bean, targets) rather than its
   * annotations.
   *
   * The gateway's PUT replaces `workflow` wholesale, so a patch built from the
   * context alone would drop everything else the workflow carries — the
   * embedded profile above all. This fetches the full record first and sends a
   * MERGED workflow, which is what NSX's own shot review does inline.
   */
  async function updateShotWorkflowContext(id, ctxPatch) {
    const full = await getShotDetails(id);
    const merged = {
      ...(full?.workflow || {}),
      context: { ...(full?.workflow?.context || {}), ...ctxPatch },
    };
    return updateShot(id, { workflow: merged });
  }

  async function updateShotMeta(id, patch) {
    const { updateShotMetadata: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.updateShotMetadata not available");
    return api(id, patch);
  }

  NSXCore.register({
    getCachedShotDetails,
    getShotDetails,
    fetchShotsForWorkflow,
    invalidateShotDetails,
    deleteShot,
    updateShot,
    updateShotWorkflowContext,
    updateShotMeta,
  });
})();
