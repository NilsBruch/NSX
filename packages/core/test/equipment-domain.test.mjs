// Covers the equipment domain: baskets + general kit in DYE2's KV namespace.
// The interesting behaviour is all in the contract's rough edges — a
// never-written key answers `null`, every mutation rewrites a whole array,
// and we are a second writer next to DYE2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/equipment.js");
const NSXCore = window.NSXCore;

/** A stand-in KV store: `store` is { key: value } under dye2.reaplugin. */
function mockStore(store = {}) {
  const writes = [];
  window.NSXApi = {
    getStoreNamespace: async (ns) => {
      assert.equal(ns, "dye2.reaplugin");
      return store;
    },
    getStoreValue: async (ns, key) => {
      assert.equal(ns, "dye2.reaplugin");
      return store[key] ?? null;
    },
    setStoreValue: async (ns, key, value) => {
      writes.push([key, value]);
      store[key] = value;
    },
  };
  return { store, writes };
}

test("loadEquipmentLibrary reads both keys in one namespace call and tags each row", async () => {
  mockStore({
    baskets: [{ id: "bskt-1", name: "VST 18g", size: "double" }],
    equipment: [{ id: "eqp-1", name: "Acaia Lunar" }],
  });
  const seen = {};
  NSXCore.on("basketsLoaded", (p) => { seen.baskets = p.baskets; });
  NSXCore.on("equipmentLoaded", (p) => { seen.equipment = p.equipment; });

  await NSXCore.loadEquipmentLibrary();

  assert.equal(NSXCore.getBaskets()[0].name, "VST 18g");
  assert.equal(NSXCore.getBaskets()[0].type, "basket", "derived, for a future typed endpoint");
  assert.equal(NSXCore.getEquipment()[0].type, "other");
  assert.deepEqual(seen.baskets, NSXCore.getBaskets());
  assert.deepEqual(seen.equipment, NSXCore.getEquipment());
});

test("a key nobody has written yet is an empty collection, not an error", async () => {
  // The contract: Decaid's kv_store_handler always answers 200, with `null`
  // for an unwritten key. Junk of any other shape is treated the same way.
  mockStore({ baskets: null, equipment: "not an array" });

  await NSXCore.loadEquipmentLibrary();

  assert.deepEqual(NSXCore.getBaskets(), []);
  assert.deepEqual(NSXCore.getEquipment(), []);
});

test("saving a new basket mints an id and createdAt, and appends to the stored array", async () => {
  const { writes } = mockStore({ baskets: [{ id: "bskt-old", name: "Stock" }] });

  const saved = await NSXCore.saveBasket({ name: "VST 18g", size: "double", diameterMm: 58 });

  assert.match(saved.id, /^bskt-/);
  assert.ok(saved.createdAt, "the contract's rows carry an ISO timestamp");
  const [key, value] = writes[0];
  assert.equal(key, "baskets");
  assert.equal(value.length, 2, "the whole array is rewritten, with the old row kept");
  assert.equal(value[0].id, "bskt-old");
  assert.equal(value[1].name, "VST 18g");
});

test("`type` is ours in memory and never reaches DYE2's store", async () => {
  const { writes } = mockStore({ baskets: [] });

  await NSXCore.saveBasket({ name: "Bottomless", type: "basket" });

  assert.equal("type" in writes[0][1][0], false);
});

test("an edit re-reads the key first, so a row DYE2 added meanwhile survives", async () => {
  // The clobber the single-writer rule warns about: we load, DYE2 writes, we
  // save. Because the mutation re-GETs rather than writing back the list it
  // loaded from, DYE2's row is still there afterwards.
  const { store, writes } = mockStore({ baskets: [{ id: "bskt-1", name: "VST 18g" }] });
  await NSXCore.loadEquipmentLibrary();

  store.baskets = [...store.baskets, { id: "bskt-dye2", name: "Added in DYE2" }];
  await NSXCore.saveBasket({ ...NSXCore.getBaskets()[0], name: "VST 20g" });

  const written = writes[0][1];
  assert.deepEqual(written.map((r) => r.id), ["bskt-1", "bskt-dye2"]);
  assert.equal(written[0].name, "VST 20g", "our edit applied");
});

test("an edit keeps fields this version doesn't know about", async () => {
  const { writes } = mockStore({
    equipment: [{ id: "eqp-1", name: "Lunar", someFutureField: 42 }],
  });

  await NSXCore.saveEquipmentItem({ id: "eqp-1", name: "Acaia Lunar" });

  assert.equal(writes[0][1][0].someFutureField, 42);
  assert.equal(writes[0][1][0].name, "Acaia Lunar");
});

test("deleting rewrites the array without that row", async () => {
  const { writes } = mockStore({
    equipment: [{ id: "eqp-1", name: "Lunar" }, { id: "eqp-2", name: "Tamper" }],
  });

  await NSXCore.deleteEquipmentItem("eqp-1");

  assert.deepEqual(writes[0][1].map((r) => r.id), ["eqp-2"]);
});

test("a first save works where the single-key GET 404s instead of answering null", async () => {
  // The mock gateway 404s a key nobody has written; the real one answers 200
  // with null. Either way the first basket has to save.
  const writes = [];
  window.NSXApi = {
    getStoreValue: async () => { throw new Error("not found"); },
    getStoreNamespace: async () => ({}),
    setStoreValue: async (ns, key, value) => { writes.push([key, value]); },
  };

  await NSXCore.saveBasket({ name: "VST 18g" });

  assert.equal(writes[0][1].length, 1);
  assert.equal(writes[0][1][0].name, "VST 18g");
});

test("a read that fails outright aborts the write instead of erasing the array", async () => {
  // The dangerous case: treating an unreadable key as empty would make the
  // whole-array rewrite below wipe every row DYE2 has.
  let wrote = false;
  window.NSXApi = {
    getStoreValue: async () => { throw new Error("network down"); },
    getStoreNamespace: async () => { throw new Error("network down"); },
    setStoreValue: async () => { wrote = true; },
  };

  await assert.rejects(() => NSXCore.saveBasket({ name: "VST 18g" }), /network down/);
  assert.equal(wrote, false);
});

test("custom fields read defensively and write only the named pairs", async () => {
  assert.deepEqual(NSXCore.getCustomFields({ custom: [{ key: "Weight", value: "250g" }] }),
    [{ key: "Weight", value: "250g" }]);
  assert.deepEqual(NSXCore.getCustomFields({}), [], "older rows have no `custom` at all");
  assert.deepEqual(NSXCore.getCustomFields(null), []);

  assert.deepEqual(
    NSXCore.normalizeCustomFields([
      { key: " Burr size ", value: " 64mm " },
      { key: "", value: "orphaned" },
      { key: "Empty", value: "" },
    ]),
    [{ key: "Burr size", value: "64mm" }, { key: "Empty", value: "" }],
    "a row without a name is dropped; a named row without a value is kept",
  );
});

/* ── Reading the DYE fields back off a shot ──────────────────────────────── */

test("dyeFieldsFromContext reads both halves of a recorded context", () => {
  assert.deepEqual(
    NSXCore.dyeFieldsFromContext({
      baristaName: "Nils", drinkerName: "", finalBeverageType: "espresso",
      extras: { tags: ["morning"], basketId: "bskt-1", basketName: "VST 18g" },
    }),
    {
      baristaName: "Nils", drinkerName: null, finalBeverageType: "espresso",
      basketId: "bskt-1", basketName: "VST 18g", equipmentId: null, equipmentName: null,
      rpm: null,
    },
  );
});

test("a shot pulled before any of this, or with no context at all, reads as empty", () => {
  const empty = {
    baristaName: null, drinkerName: null, finalBeverageType: null,
    basketId: null, basketName: null, equipmentId: null, equipmentName: null, rpm: null,
  };
  assert.deepEqual(NSXCore.dyeFieldsFromContext({}), empty);
  assert.deepEqual(NSXCore.dyeFieldsFromContext(null), empty);
  assert.equal(NSXCore.isDyeEmpty(NSXCore.dyeFieldsFromContext(null)), true);
  assert.equal(NSXCore.isDyeEmpty({ basketName: "VST 18g" }), false);
});

/* ── Where a SAVED shot keeps basket / equipment / RPM ───────────────────── */

test("dyeShotExtras reads annotations.extras — the object DYE2 actually reads", () => {
  // The bug this guards: the same keys in workflow.context.extras are what a
  // recipe PUSHES, but DYE2's edit-shot page reads a saved shot's copy out of
  // annotations.extras. Writing only the workflow context is invisible to it.
  const shot = {
    annotations: { extras: { basketId: 'bskt-1', basketName: 'VST 18g', rpm: 900 } },
    workflow: { context: { extras: { basketId: 'bskt-WRONG', basketName: 'Not this one' } } },
  };

  assert.deepEqual(NSXCore.dyeShotExtras(shot), {
    basketId: 'bskt-1', basketName: 'VST 18g',
    equipmentId: null, equipmentName: null, rpm: 900,
  });
});

test("RPM falls back to the legacy workflow.grinderData.rpm DYE2 still reads", () => {
  const shot = { annotations: {}, workflow: { grinderData: { rpm: 750 } } };
  assert.equal(NSXCore.dyeShotExtras(shot).rpm, 750);

  // An annotation always wins over the legacy field.
  const edited = { annotations: { extras: { rpm: 800 } }, workflow: { grinderData: { rpm: 750 } } };
  assert.equal(NSXCore.dyeShotExtras(edited).rpm, 800);
});

test("a shot with no extras at all reads as empty, not as a crash", () => {
  const empty = { basketId: null, basketName: null, equipmentId: null, equipmentName: null, rpm: null };
  assert.deepEqual(NSXCore.dyeShotExtras({}), empty);
  assert.deepEqual(NSXCore.dyeShotExtras(null), empty);
});

test("a recipe's RPM pushes in context.extras, beside basket and equipment", () => {
  assert.deepEqual(NSXCore.dyeExtras({ rpm: 900, basketId: 'bskt-1' }), { rpm: 900, basketId: 'bskt-1' });
  assert.equal('rpm' in NSXCore.normalizeDye(null), true);
});
