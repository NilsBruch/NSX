"use strict";
/**
 * NSXCore equipment domain — the prep kit a shot is pulled with: filter
 * baskets and everything else (scale, tamper, WDT tool, kettle…).
 *
 * Unlike grinders, these have NO typed bridge resource. Decaid's
 * `/api/v1/equipment` was proposed in decentespresso/decaid#727 and closed
 * unmerged, so both collections live in the DYE2 plugin's generic KV store,
 * documented in dye2-plugin/KV_CONTRACT.md:
 *
 *   namespace "dye2.reaplugin", keys "baskets" and "equipment",
 *   each holding ONE JSON array that is rewritten whole on every mutation.
 *
 * We read and write that namespace deliberately, so a basket defined in Nova
 * shows up in DYE2 and vice versa. Two things follow from the contract:
 *
 *  - **A never-written key answers 200 with `null`**, not 404 (Decaid's
 *    kv_store_handler always responds jsonOk). Anything that isn't an array
 *    — null included — is an empty collection, never an error.
 *  - **DYE2 declares itself sole writer.** We are a second one, so every
 *    mutation below re-reads the key immediately before writing and splices
 *    into the array it just got back. That can't make the whole-array rewrite
 *    atomic, but it narrows the window in which we'd clobber a concurrent
 *    DYE2 edit from "however long the panel was open" to the round trip.
 *
 * `type` is derived on read ('basket' | 'other') and stripped on write. The
 * closed PR modelled both collections as ONE resource discriminated by
 * `type`, so carrying it in memory now means a future switch to a typed
 * endpoint is a filter rather than a reshape — while stripping it on write
 * keeps our field out of DYE2's store.
 *
 * Registered on NSXCore:
 *   Selectors: getBaskets(), getEquipment()
 *   Commands:  loadEquipmentLibrary(), saveBasket(item), deleteBasket(id),
 *              saveEquipmentItem(item), deleteEquipmentItem(id)
 *   Events:    'basketsLoaded' -> { baskets }
 *              'equipmentLoaded' -> { equipment }
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.equipment] core.js must load before domains/equipment.js");
    return;
  }

  const NS = "dye2.reaplugin";
  const KEY_BASKETS = "baskets";
  const KEY_EQUIPMENT = "equipment";

  let _baskets = [];
  let _equipment = [];

  function getBaskets() { return _baskets; }
  function getEquipment() { return _equipment; }

  /** Any non-array value (null for a never-written key) is an empty list. */
  const asArray = (v) => (Array.isArray(v) ? v : []);

  /** Rows come back as DYE2 wrote them; `type` is ours, added on the way in. */
  const withType = (list, type) =>
    asArray(list).filter((r) => r && typeof r === "object").map((r) => ({ ...r, type }));

  /** …and removed on the way out, so DYE2's store keeps only its own fields. */
  function stripType(row) {
    const { type, ...rest } = row;
    return rest;
  }

  function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Both keys in one ETag-conditional namespace read, so a poll that finds
   * nothing changed costs a 304. The KV store has no push channel — callers
   * re-run this on panel open and on visibilitychange.
   */
  async function loadEquipmentLibrary() {
    const { getStoreNamespace } = window.NSXApi || {};
    if (typeof getStoreNamespace !== "function") return;
    const all = (await getStoreNamespace(NS)) || {};
    _baskets = withType(all[KEY_BASKETS], "basket");
    _equipment = withType(all[KEY_EQUIPMENT], "other");
    NSXCore.emit("basketsLoaded", { baskets: _baskets });
    NSXCore.emit("equipmentLoaded", { equipment: _equipment });
  }

  /**
   * The current array for one key, read fresh (the single-key GET has no ETag
   * layer, unlike the namespace read).
   *
   * A key nobody has written is the awkward case: the contract says Decaid
   * answers 200 with `null`, but the mock gateway 404s it, and `request()`
   * turns a 404 into a thrown Error whose message is the body's — so there is
   * no reliable status to sniff. Rather than guess, fall back to the
   * namespace read, which always answers 200 with a dict: an absent key there
   * really is an empty collection. If THAT fails too, throw. Turning a
   * transient read failure into `[]` would make the whole-array write below
   * erase the collection, which is the one thing this must never do.
   */
  async function readKey(key) {
    const { getStoreValue, getStoreNamespace } = window.NSXApi || {};
    try {
      return asArray(await getStoreValue(NS, key));
    } catch (err) {
      if (typeof getStoreNamespace !== "function") throw err;
      const all = (await getStoreNamespace(NS)) || {};
      return asArray(all[key]);
    }
  }

  /**
   * Read-modify-write against one key: re-read it, replace the row with a
   * matching id or append it, then POST the whole array back. Returns the
   * saved row.
   */
  async function upsert(key, item, idPrefix) {
    const { getStoreValue, setStoreValue } = window.NSXApi || {};
    if (typeof getStoreValue !== "function" || typeof setStoreValue !== "function") {
      throw new Error("NSXApi store access not available");
    }
    const row = { ...stripType(item) };
    if (!row.id) row.id = newId(idPrefix);
    if (!row.createdAt) row.createdAt = new Date().toISOString();

    const current = await readKey(key);
    const at = current.findIndex((r) => r && r.id === row.id);
    // Merge onto the stored row rather than replacing it: fields this version
    // doesn't know about (DYE2's own, or a newer one's) survive our edit.
    const next = at >= 0
      ? current.map((r, i) => (i === at ? { ...r, ...row } : r))
      : [...current, row];

    await setStoreValue(NS, key, next);
    return row;
  }

  async function removeById(key, id) {
    const { getStoreValue, setStoreValue } = window.NSXApi || {};
    if (typeof getStoreValue !== "function" || typeof setStoreValue !== "function") {
      throw new Error("NSXApi store access not available");
    }
    const current = await readKey(key);
    await setStoreValue(NS, key, current.filter((r) => !r || r.id !== id));
  }

  const saveBasket = (item) => upsert(KEY_BASKETS, item, "bskt");
  const deleteBasket = (id) => removeById(KEY_BASKETS, id);
  const saveEquipmentItem = (item) => upsert(KEY_EQUIPMENT, item, "eqp");
  const deleteEquipmentItem = (id) => removeById(KEY_EQUIPMENT, id);

  /**
   * The free-text fields a user names themselves on an equipment row
   * ("Weight: 250g", "Burr size: 64mm"). The contract fixes no schema for
   * `custom` beyond an array of { key, value }, and older rows lack it
   * entirely — so read it defensively and write only the filled pairs.
   */
  function getCustomFields(item) {
    return asArray(item?.custom)
      .filter((f) => f && typeof f === "object")
      .map((f) => ({ key: String(f.key ?? ""), value: String(f.value ?? "") }));
  }

  function normalizeCustomFields(fields) {
    return asArray(fields)
      .map((f) => ({ key: String(f?.key ?? "").trim(), value: String(f?.value ?? "").trim() }))
      .filter((f) => f.key !== "");
  }

  /* ── The DYE fields a recipe carries onto every shot pulled with it ─────
   *
   * Same trick the recipe's tags already use: the values ride along in the
   * workflow context pushed to the gateway, so the SHOT records what the
   * recipe carried at the time. Editing the recipe later cannot rewrite a
   * shot that was already pulled, which is the whole point.
   *
   * They land in two different places, because that's where the readers look:
   *  - barista / drinker / beverage are native gateway context fields (the
   *    shot DYE page already edits them there).
   *  - basket, equipment and grinder RPM have no native home. On the LIVE
   *    workflow they go in `context.extras` (what DYE2's workflowDialing
   *    reads); on a SAVED shot they live in `annotations.extras` (what its
   *    shotDialing reads — see dyeShotExtras below). Those are two different
   *    objects on a shot record, and writing the wrong one is invisible to
   *    DYE2, so the two directions have separate helpers here.
   *
   * RPM has no schema field anywhere: `GrinderRequest` carries only
   * rpmSmallStep/rpmBigStep (how far one press moves it), never a value.
   */
  const DYE_CONTEXT_KEYS = ["baristaName", "drinkerName", "finalBeverageType"];
  const DYE_EXTRAS_KEYS = ["basketId", "basketName", "equipmentId", "equipmentName", "rpm"];

  const blank = (v) => v == null || v === "";

  /** The DYE fields recorded on a shot (or on the live workflow), read back. */
  function dyeFieldsFromContext(context) {
    const ctx = context || {};
    const extras = ctx.extras || {};
    const out = {};
    for (const k of DYE_CONTEXT_KEYS) out[k] = blank(ctx[k]) ? null : ctx[k];
    for (const k of DYE_EXTRAS_KEYS) out[k] = blank(extras[k]) ? null : extras[k];
    return out;
  }

  /**
   * The native context half. Every key is always present, null included:
   * omitting a context field leaves the gateway's PREVIOUS value in place, so
   * an explicit null is what clears a barista the recipe no longer names.
   * (Same rule buildGatewayPayload documents for targetWaterVolume.)
   */
  function dyeContextFields(dye) {
    const d = dye || {};
    const out = {};
    for (const k of DYE_CONTEXT_KEYS) out[k] = blank(d[k]) ? null : d[k];
    return out;
  }

  /**
   * The `extras` half — only the keys that have a value. `extras` is replaced
   * wholesale on each push rather than merged, so leaving a key out already
   * clears it and a null would just be noise in DYE2's store.
   */
  function dyeExtras(dye) {
    const d = dye || {};
    const out = {};
    for (const k of DYE_EXTRAS_KEYS) if (!blank(d[k])) out[k] = d[k];
    return out;
  }

  /**
   * The basket / equipment / RPM recorded on a SAVED shot.
   *
   * These live in `annotations.extras`, NOT in the shot's workflow context —
   * DYE2's edit-shot page reads and writes them there, and a value put in the
   * workflow context instead is simply not seen by it. `rpm` additionally
   * falls back to `workflow.grinderData.rpm`, a legacy shape DYE2 still reads
   * and which appears in no REST schema.
   */
  function dyeShotExtras(shot) {
    const extras = shot?.annotations?.extras || {};
    const out = {};
    for (const k of DYE_EXTRAS_KEYS) out[k] = blank(extras[k]) ? null : extras[k];
    if (out.rpm == null) {
      const legacy = shot?.workflow?.grinderData?.rpm;
      if (!blank(legacy)) out.rpm = legacy;
    }
    return out;
  }

  /**
   * A flat DYE object with every key present, missing ones as null — for a
   * recipe loaded from storage that predates the field, or a brand new one.
   */
  function normalizeDye(dye) {
    const d = dye || {};
    const out = {};
    for (const k of [...DYE_CONTEXT_KEYS, ...DYE_EXTRAS_KEYS]) out[k] = blank(d[k]) ? null : d[k];
    return out;
  }

  /**
   * The beverage types Decent itself names. An OPEN set in the API, so a
   * picker offers these and lets anything already recorded (by another skin
   * or by DYE2) join the list rather than silently replacing it — see
   * dyeBeverageOptions.
   */
  const BEVERAGE_TYPES = ["espresso", "filter", "lungo", "americano"];

  function dyeBeverageOptions(current) {
    return current && !BEVERAGE_TYPES.includes(current)
      ? [current, ...BEVERAGE_TYPES]
      : [...BEVERAGE_TYPES];
  }

  /** True when a recipe has nothing DYE-ish set — for "not set" in the UI. */
  function isDyeEmpty(dye) {
    const d = dye || {};
    return [...DYE_CONTEXT_KEYS, ...DYE_EXTRAS_KEYS].every((k) => blank(d[k]));
  }

  NSXCore.register({
    dyeBeverageOptions,
    dyeFieldsFromContext,
    dyeShotExtras,
    normalizeDye,
    dyeContextFields,
    dyeExtras,
    isDyeEmpty,
    getBaskets,
    getEquipment,
    loadEquipmentLibrary,
    saveBasket,
    deleteBasket,
    saveEquipmentItem,
    deleteEquipmentItem,
    getCustomFields,
    normalizeCustomFields,
  });
})();
