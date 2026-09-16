/**
 * Temperature in the unit the user reads, everywhere in the skin.
 *
 * The gateway is Celsius-only — profile frames, steam and flush targets, the
 * live group temperature — so Fahrenheit exists strictly at the edges of the
 * UI: convert on the way out to a readout or a picker, convert straight back on
 * the way in. Nothing stores a Fahrenheit value, and nothing sends one.
 *
 * The arithmetic itself is core's units domain (any skin needs it identically);
 * what lives here is the binding to THIS skin's stored preference, so a
 * component can write `dispTemp(c)` without repeating the lookup.
 */
import { computed } from 'vue';
import { skinSettings } from './useSettings.js';

const { NSXCore } = window;

/** 'C' | 'F' — reactive, so a change re-renders every readout at once. */
export const tempUnit = computed(() => skinSettings.tempUnit || 'C');
/** '°C' | '°F' */
export const tempUnitLabel = computed(() => NSXCore.temperatureUnitLabel(tempUnit.value));

/** A gateway Celsius value as a NUMBER in the display unit (rounded). */
export function dispTemp(celsius, digits = 0) {
  const v = NSXCore.celsiusToDisplay(celsius, tempUnit.value);
  if (!Number.isFinite(Number(v))) return v;
  return Number(Number(v).toFixed(digits));
}

/** A value the user entered, back in Celsius for the gateway. */
export function toCelsius(value) {
  return NSXCore.displayToCelsius(value, tempUnit.value);
}

/** '93°C' / '199°F' — the whole readout, unit included. */
export function fmtTemp(celsius, digits = 0) {
  return NSXCore.formatTemperature(celsius, tempUnit.value, digits);
}

/** A slider's or picker's Celsius bounds, in the display unit. */
export function tempRange(minC, maxC) {
  return NSXCore.temperatureRange(minC, maxC, tempUnit.value);
}
