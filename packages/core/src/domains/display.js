/**
 * NSXCore.display — what the gateway's HOST PLATFORM can actually do to the
 * screen.
 *
 * `GET /api/v1/display` answers with, among the live values, a
 * `platformSupported: { brightness, wakeLock }` pair. On a host where the
 * gateway cannot drive the backlight or hold a wake lock, every
 * setDisplayBrightness / requestWakeLockOverride call is a no-op — so a skin
 * showing a brightness slider or a "keep screen awake" switch there is offering
 * a control that provably does nothing. Skins read these selectors to hide such
 * controls instead.
 *
 * Selectors: getDisplaySupport()
 * Commands:  loadDisplaySupport(force?)
 * Event:     'displaySupportLoaded' -> { brightness, wakeLock }
 *
 * Capability, not state: it is a property of the machine the gateway runs on
 * and cannot change while the skin is open, so it is fetched once and cached
 * (the live values in the same response are NOT cached here — read those from
 * NSXApi.fetchDisplayState() when you need them fresh).
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.display] core.js must load before domains/display.js");
    return;
  }

  // Optimistic default: a gateway too old to report platformSupported, or one
  // that is briefly unreachable, must not make the controls disappear — the
  // pre-existing behaviour (assume it works) is the safe answer there.
  let support = { brightness: true, wakeLock: true };
  let loaded = false;

  function getDisplaySupport() {
    return support;
  }

  async function loadDisplaySupport(force = false) {
    if (loaded && !force) return support;
    try {
      const state = await window.NSXApi.fetchDisplayState();
      const ps = state && state.platformSupported;
      // Only an explicit `false` hides a control; a missing field means the
      // gateway doesn't report capabilities at all -> assume supported.
      support = {
        brightness: !ps || ps.brightness !== false,
        wakeLock: !ps || ps.wakeLock !== false,
      };
      loaded = true;
      NSXCore.emit("displaySupportLoaded", support);
    } catch {
      // Keep the optimistic default; a later call can retry.
    }
    return support;
  }

  NSXCore.register({ getDisplaySupport, loadDisplaySupport });
})();
