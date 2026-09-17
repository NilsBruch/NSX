// Covers importFromNamespace: the one-time copy of an NSX user's data into
// Nova's namespace on Nova's first start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("store.js");
const NSXCore = window.NSXCore;
NSXCore.setStoreNamespace("Nova");

const OPTS = {
  markerKey: "nova_nsx_import",
  keys: ["recipes", "nsx_steam_presets", "nsx_flush_presets"],
  defaults: { nova_graph_mode: "expert", nova_coffee_graph: true },
};

// In-memory gateway store: { ns: { key: value } }. failWrites makes the n-th
// write (1-based) throw, to simulate a boot interrupted halfway.
function mockGateway(data, { failWrite = 0 } = {}) {
  let writeCount = 0;
  const writes = [];
  window.NSXApi = {
    getStoreNamespace: async (ns) => ({ ...(data[ns] || {}) }),
    setStoreValue: async (ns, key, value) => {
      writeCount += 1;
      if (writeCount === failWrite) throw new Error("offline");
      writes.push([ns, key]);
      (data[ns] ||= {})[key] = value;
    },
  };
  return { data, writes };
}

test("an NSX user gets recipes, presets and the NSX-like defaults; NSX is untouched", async () => {
  const nsx = { recipes: [{ id: "r1" }], nsx_steam_presets: { hot: 1 }, nsx_schedule: { enabled: true }, nsx_sbw_enabled: true };
  const { data, writes } = mockGateway({ NSX: structuredClone(nsx) });

  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "imported");
  assert.deepEqual(data.Nova.recipes, [{ id: "r1" }]);
  assert.deepEqual(data.Nova.nsx_steam_presets, { hot: 1 });
  assert.equal(data.Nova.nova_graph_mode, "expert");
  assert.equal(data.Nova.nova_coffee_graph, true);
  assert.equal(data.Nova.nova_nsx_import.imported, true);
  assert.equal("nsx_schedule" in data.Nova, false, "keys not listed are not copied");
  assert.equal("nsx_flush_presets" in data.Nova, false, "keys the source lacks are not written");
  assert.deepEqual(data.NSX, nsx, "source namespace is never written");
  assert.deepEqual(writes.at(-1), ["Nova", "nova_nsx_import"], "marker is written last");

  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "skipped", "runs only once");
});

test("no NSX recipes: only the marker is written, Nova keeps its defaults", async () => {
  const { data } = mockGateway({ NSX: { nsx_steam_presets: { hot: 1 } } });
  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "nothing");
  assert.deepEqual(Object.keys(data.Nova), ["nova_nsx_import"]);
  assert.equal(data.Nova.nova_nsx_import.imported, false);
});

test("a Nova namespace that already has recipes is left alone", async () => {
  const { data, writes } = mockGateway({ NSX: { recipes: [{ id: "old" }] }, Nova: { recipes: [{ id: "mine" }] } });
  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "skipped");
  assert.deepEqual(writes, []);
  assert.deepEqual(data.Nova.recipes, [{ id: "mine" }]);
});

test("keys Nova already has are not overwritten", async () => {
  const { data } = mockGateway({
    NSX: { recipes: [{ id: "r1" }], nsx_steam_presets: { hot: 1 } },
    Nova: { nsx_steam_presets: { hot: 7 }, nova_graph_mode: "normal" },
  });
  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "imported");
  assert.deepEqual(data.Nova.nsx_steam_presets, { hot: 7 });
  assert.equal(data.Nova.nova_graph_mode, "normal");
  assert.deepEqual(data.Nova.recipes, [{ id: "r1" }]);
});

test("an interrupted import resumes on the next boot", async () => {
  const data = { NSX: { recipes: [{ id: "r1" }], nsx_steam_presets: { hot: 1 } } };
  mockGateway(data, { failWrite: 2 });
  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "error");
  assert.equal("nova_nsx_import" in data.Nova, false, "no marker after a failure");

  mockGateway(data);
  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "imported");
  assert.deepEqual(data.Nova.recipes, [{ id: "r1" }]);
  assert.deepEqual(data.Nova.nsx_steam_presets, { hot: 1 });
  assert.equal(data.Nova.nova_nsx_import.imported, true);
});

test("a failed read writes nothing", async () => {
  const writes = [];
  window.NSXApi = {
    getStoreNamespace: async () => { throw new Error("offline"); },
    setStoreValue: async (ns, key) => { writes.push(key); },
  };
  assert.equal(await NSXCore.importFromNamespace("NSX", OPTS), "error");
  assert.deepEqual(writes, []);
});
