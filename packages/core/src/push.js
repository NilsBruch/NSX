"use strict";
/**
 * NSXCore push helpers — the shared, headless gateway-write primitives.
 *
 * `push(payload)` sends a machine-settings patch via NSXApi.pushWorkflow and, on
 * failure, emits a 'toast' core event (presentations subscribe and render it —
 * no DOM access lives here). `debounced(key, fn, ms)` is a pure keyed debounce.
 *
 * Domain-specific writers (pushSteamTemp, pushFlushFlow, …) stay with their
 * domains and build on these two primitives.
 *
 * Registered on NSXCore:
 *   Commands: push(payload), debounced(key, fn, ms)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.push] core.js must load before push.js");
    return;
  }

  function push(payload) {
    const pushWorkflow = (window.NSXApi || {}).pushWorkflow;
    if (typeof pushWorkflow !== "function") return;
    pushWorkflow(payload).catch((err) => {
      const t = window.NSXI18n?.t || ((k) => k);
      NSXCore.emit("toast", t("toast.settingsFailed") + ": " + err.message);
    });
  }

  const _debounce = {};
  function debounced(key, fn, ms = 1000) {
    clearTimeout(_debounce[key]);
    _debounce[key] = setTimeout(fn, ms);
  }

  NSXCore.register({ push, debounced });
})();
