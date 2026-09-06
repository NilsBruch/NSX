// Covers the devices domain: the on-demand REST list + connect/scan/disconnect
// actions a settings screen needs (distinct from the live "devices" bridged event).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/devices.js");
const NSXCore = window.NSXCore;

test("loadDevices populates the cache and emits devicesLoaded", async () => {
  const list = [{ id: "d1", type: "scale", connected: true }];
  window.NSXApi = { fetchDevices: async () => list };
  let emitted = null;
  NSXCore.on("devicesLoaded", (p) => { emitted = p; });

  const result = await NSXCore.loadDevices();

  assert.equal(result, list);
  assert.equal(NSXCore.getDevices(), list);
  assert.deepEqual(emitted, { devices: list });
});

test("loadDevices tolerates a { items } envelope like the other list domains", async () => {
  window.NSXApi = { fetchDevices: async () => ({ items: [{ id: "d1" }] }) };
  const result = await NSXCore.loadDevices();
  assert.equal(result.length, 1);
});

test("connectToDevice / disconnectDevice delegate to NSXApi with the device id", async () => {
  const calls = [];
  window.NSXApi = {
    connectDevice: async (id) => { calls.push(["connect", id]); },
    disconnectDevice: async (id) => { calls.push(["disconnect", id]); },
  };

  await NSXCore.connectToDevice("mock-scale-1");
  await NSXCore.disconnectDevice("mock-scale-1");

  assert.deepEqual(calls, [["connect", "mock-scale-1"], ["disconnect", "mock-scale-1"]]);
});

test("scanForDevices throws a clear error when NSXApi lacks the method", async () => {
  window.NSXApi = {};
  await assert.rejects(() => NSXCore.scanForDevices(), /scanDevices not available/);
});
