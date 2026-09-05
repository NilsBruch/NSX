"use strict";
/**
 * NSXCore devices domain — headless cache + connect/disconnect for BLE devices
 * (the machine and any scale), plus the "preferred device" / scale-power-mode
 * preferences that live alongside them in app settings.
 *
 * Registered on NSXCore:
 *   Selectors: getDevices()
 *   Commands:  loadDevices(), scanForDevices(), connectToDevice(deviceId),
 *              disconnectDevice(deviceId)
 *   Event:     'devicesLoaded' -> { devices }
 *
 * Live connection status (connected/disconnected as it happens) is a separate
 * concern already covered by the "devices" bridged event in core.js (raw
 * gateway push) — this domain is the on-demand REST list + the actions a
 * settings screen needs, not a live subscription.
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.devices] core.js must load before domains/devices.js");
    return;
  }

  let _cache = [];

  function getDevices() { return _cache; }

  async function loadDevices() {
    const { fetchDevices } = window.NSXApi || {};
    if (typeof fetchDevices !== "function") return _cache;
    const res = await fetchDevices();
    _cache = Array.isArray(res) ? res : (res?.items ?? []);
    NSXCore.emit("devicesLoaded", { devices: _cache });
    return _cache;
  }

  async function scanForDevices() {
    const { scanDevices } = window.NSXApi || {};
    if (typeof scanDevices !== "function") throw new Error("NSXApi.scanDevices not available");
    return scanDevices();
  }

  async function connectToDevice(deviceId) {
    const { connectDevice } = window.NSXApi || {};
    if (typeof connectDevice !== "function") throw new Error("NSXApi.connectDevice not available");
    return connectDevice(deviceId);
  }

  async function disconnectDevice(deviceId) {
    const { disconnectDevice: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.disconnectDevice not available");
    return api(deviceId);
  }

  NSXCore.register({
    getDevices,
    loadDevices,
    scanForDevices,
    connectToDevice,
    disconnectDevice,
  });
})();
