"use strict";
/**
 * NSXCore devices domain — headless cache + connect/disconnect for BLE devices
 * (the machine and any scale), plus the "preferred device" / scale-power-mode
 * preferences that live alongside them in app settings.
 *
 * Registered on NSXCore:
 *   Selectors: getDevices(), getWifiScales()
 *   Commands:  loadDevices(), scanForDevices(), connectToDevice(deviceId),
 *              disconnectDevice(deviceId), forgetDevice(deviceId),
 *              loadWifiScales(), addWifiScale(host), removeWifiScale(host)
 *   Events:    'devicesLoaded' -> { devices }, 'wifiScalesLoaded' -> { hosts }
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

  /**
   * Drop a device's pairing for good, as opposed to disconnecting it: the
   * gateway stops reaching for it on startup. Refreshes the list, since the
   * device leaves it.
   */
  async function forgetDevice(deviceId) {
    const { forgetDevice: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.forgetDevice not available");
    await api(deviceId);
    return loadDevices();
  }

  /* ── Wi-Fi scales ──────────────────────────────────────────
   * Not discovered: a network scale is reached at a host the user types in, so
   * the list is configuration rather than a scan result. All three calls return
   * the full list, so all three refresh the cache.
   */
  let _wifiScales = [];

  function getWifiScales() { return _wifiScales; }

  function _setWifiScales(hosts) {
    _wifiScales = Array.isArray(hosts) ? hosts : [];
    NSXCore.emit("wifiScalesLoaded", { hosts: _wifiScales });
    return _wifiScales;
  }

  async function loadWifiScales() {
    const { fetchWifiScales } = window.NSXApi || {};
    if (typeof fetchWifiScales !== "function") return _wifiScales;
    return _setWifiScales(await fetchWifiScales().catch(() => []));
  }

  async function addWifiScale(host) {
    const { addWifiScale: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.addWifiScale not available");
    const clean = String(host || "").trim();
    if (!clean) throw new Error("No host given");
    return _setWifiScales(await api(clean));
  }

  async function removeWifiScale(host) {
    const { removeWifiScale: api } = window.NSXApi || {};
    if (typeof api !== "function") throw new Error("NSXApi.removeWifiScale not available");
    return _setWifiScales(await api(host));
  }

  NSXCore.register({
    getDevices,
    getWifiScales,
    forgetDevice,
    loadWifiScales,
    addWifiScale,
    removeWifiScale,
    loadDevices,
    scanForDevices,
    connectToDevice,
    disconnectDevice,
  });
})();
