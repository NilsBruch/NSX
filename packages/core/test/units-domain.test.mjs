// Covers the units domain: the °C <-> °F boundary a skin converts at, and the
// rounding that keeps a value edited twice from drifting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/units.js");
const { celsiusToDisplay, displayToCelsius, formatTemperature, temperatureUnitLabel, temperatureRange } = window.NSXCore;

test("Celsius passes through untouched; Fahrenheit converts", () => {
  assert.equal(celsiusToDisplay(93, "C"), 93);
  assert.equal(celsiusToDisplay(100, "F"), 212);
  assert.equal(celsiusToDisplay(0, "F"), 32);
  assert.equal(displayToCelsius(212, "F"), 100);
  assert.equal(displayToCelsius(93, "C"), 93);
});

test("an unset or unknown unit means Celsius, never a silent conversion", () => {
  assert.equal(celsiusToDisplay(93, undefined), 93);
  assert.equal(celsiusToDisplay(93, ""), 93);
  assert.equal(celsiusToDisplay(93, null), 93);
});

test("a non-numeric value is handed back as it came", () => {
  assert.equal(celsiusToDisplay(null, "F"), null);
  assert.equal(celsiusToDisplay(undefined, "F"), undefined);
  assert.equal(displayToCelsius("", "F"), "");
});

test("editing a frame twice in Fahrenheit does not walk the Celsius value", () => {
  // 93 °C reads as 199.4 °F; a picker hands back the whole degree it showed.
  let c = 93;
  for (let i = 0; i < 5; i++) {
    const shown = Math.round(celsiusToDisplay(c, "F"));
    c = displayToCelsius(shown, "F");
  }
  assert.equal(c, 92.8, "settles immediately instead of drifting a tenth per edit");
  assert.equal(Math.round(celsiusToDisplay(c, "F")), 199, "and still shows the degree the user picked");
});

test("formatTemperature carries the unit it converted to", () => {
  assert.equal(formatTemperature(93.4, "C"), "93°C");
  assert.equal(formatTemperature(93, "F"), "199°F");
  assert.equal(formatTemperature(93.46, "C", 1), "93.5°C");
  assert.equal(formatTemperature(null, "C"), "—", "nothing to show is not 0 degrees");
  assert.equal(temperatureUnitLabel("F"), "°F");
  assert.equal(temperatureUnitLabel("C"), "°C");
});

test("a control's bounds convert with it, so the range still fits the unit", () => {
  assert.deepEqual(temperatureRange(0, 105, "C"), { min: 0, max: 105, step: 1 });
  assert.deepEqual(temperatureRange(0, 105, "F"), { min: 32, max: 221, step: 1 });
  assert.deepEqual(temperatureRange(50, 100, "F"), { min: 122, max: 212, step: 1 });
});
