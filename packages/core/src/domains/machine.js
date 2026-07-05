"use strict";
/**
 * NSXCore machine domain — the current DE1 machine-state value.
 *
 * This is a PASSIVE value holder, not an auto-tracking listener: it does NOT
 * subscribe to the "machineState" event itself. app.js's own
 * NSXCore.on("machineState", ...) handler is the sole writer (via
 * setMachineState) — it needs to read the previous value BEFORE overwriting
 * it (to detect session-start/session-end transitions), all synchronously
 * within one callback. If this domain also listened to "machineState"
 * independently, script load order (core domains load before app.js) would
 * make it run first on every dispatch, so app.js's "read previous, then
 * write new" logic would always see the NEW value already — silently
 * breaking every transition check. Keeping this a plain get/set avoids that
 * race entirely: there is still exactly one writer, exactly one place that
 * reads-then-writes, same as when this was a local app.js variable.
 *
 * Also owns the machine-state operation guard (Reaprime best practice): which
 * high-level operations are legal in each machine state. This is a pure
 * business rule any DE1 skin needs identically, independent of the UI.
 *
 * Registered on NSXCore:
 *   Selectors: getMachineState(), isEspressoLikeState(state),
 *              canExecuteOperation(operation, state?)
 *   Commands:  setMachineState(state)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.machine] core.js must load before domains/machine.js");
    return;
  }

  let _state = "idle";

  function getMachineState() { return _state; }
  function setMachineState(state) { _state = state; }
  function isEspressoLikeState(state) { return state === "espresso" || state === "skipStep"; }

  const ALLOWED_OPERATIONS = {
    idle: ["setState", "uploadProfile", "updateSettings", "setWorkflow"],
    booting: ["setState"],
    sleeping: ["setState"],
    heating: ["setState"],
    preheating: ["setState"],
    espresso: ["stopShot"],
    hotWater: ["setState"],
    flush: ["setState"],
    steam: ["setState"],
    steamRinse: ["setState"],
    cleaning: ["setState"],
    descaling: ["setState"],
    error: ["setState"],
    needsWater: ["setState"],
  };

  // state defaults to the current machine state when the caller omits it.
  function canExecuteOperation(operation, state) {
    const s = state === undefined ? _state : state;
    return ALLOWED_OPERATIONS[s]?.includes(operation) ?? false;
  }

  NSXCore.register({
    getMachineState,
    setMachineState,
    isEspressoLikeState,
    canExecuteOperation,
  });
})();
