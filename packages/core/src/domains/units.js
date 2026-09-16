"use strict";
/**
 * NSXCore units domain — display units, and the conversions a skin needs to
 * both SHOW a value and take one back.
 *
 * The gateway speaks Celsius everywhere: profile frame temperatures, steam and
 * flush targets, the live group temperature. A skin that offers Fahrenheit is
 * therefore converting at the edges, never storing the user's unit anywhere the
 * machine can see it. That makes this a pure boundary layer: °C in from the
 * gateway, display value out; display value in from a picker, °C back out.
 *
 * Owns no state — the chosen unit is a skin preference, passed in on every
 * call. Keeping it that way is deliberate: a skin's settings store is already
 * the one place that remembers preferences, and two places remembering it is
 * how they come to disagree.
 *
 * Round-tripping is lossy at one decimal place in Fahrenheit (a whole °F is
 * about 0.56 °C), so `displayToCelsius` rounds to one decimal: without it, a
 * frame edited twice in °F would drift a tenth of a degree at a time.
 *
 * Registered on NSXCore:
 *   Selectors: celsiusToDisplay(c, unit), displayToCelsius(v, unit),
 *              formatTemperature(c, unit, digits?), temperatureUnitLabel(unit),
 *              temperatureRange(minC, maxC, unit)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.units] core.js must load before domains/units.js");
    return;
  }

  const isF = (unit) => String(unit || "C").toUpperCase() === "F";

  /**
   * Number(), minus the two coercions that turn "nothing" into a temperature:
   * Number(null) and Number("") are both 0, which would render an absent
   * reading as a freezing one.
   */
  function _num(value) {
    if (value === null || value === undefined || value === "") return NaN;
    return Number(value);
  }

  /** A temperature the gateway gave us, in the unit the user reads. */
  function celsiusToDisplay(celsius, unit) {
    const c = _num(celsius);
    if (!Number.isFinite(c)) return celsius;
    return isF(unit) ? c * 9 / 5 + 32 : c;
  }

  /** A temperature the user typed, back in the unit the gateway takes. */
  function displayToCelsius(value, unit) {
    const v = _num(value);
    if (!Number.isFinite(v)) return value;
    return isF(unit) ? Math.round(((v - 32) * 5 / 9) * 10) / 10 : v;
  }

  function temperatureUnitLabel(unit) {
    return isF(unit) ? "°F" : "°C";
  }

  /**
   * A whole displayed temperature, e.g. "93°C" / "199°F".
   * @param {number} celsius
   * @param {string} unit  "C" | "F"
   * @param {number} [digits] decimal places (0 by default — a tenth of a degree
   *        is below what any of these readouts can honestly claim)
   */
  function formatTemperature(celsius, unit, digits = 0) {
    const v = celsiusToDisplay(celsius, unit);
    if (!Number.isFinite(_num(v))) return "—";
    return `${Number(v).toFixed(digits)}${temperatureUnitLabel(unit)}`;
  }

  /**
   * A slider's or picker's bounds, converted — so a 0–105 °C control becomes a
   * 32–221 °F one instead of asking for a Fahrenheit value inside a Celsius
   * range. The step stays 1: a whole °F is FINER than a whole °C, so nothing is
   * lost, and a fractional step would only invite the drift displayToCelsius
   * rounds away.
   */
  function temperatureRange(minC, maxC, unit) {
    return {
      min: Math.round(celsiusToDisplay(minC, unit)),
      max: Math.round(celsiusToDisplay(maxC, unit)),
      step: 1,
    };
  }

  NSXCore.register({
    celsiusToDisplay,
    displayToCelsius,
    formatTemperature,
    temperatureUnitLabel,
    temperatureRange,
  });
})();
