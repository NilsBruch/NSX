// Covers buildShotSparkline: the thumbnail reduction behind the Diary's shot
// cards. The rules that matter are the two that make thumbnails comparable —
// a FIXED 0-12 scale (never per-shot auto-scale) and TIME-based sampling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/mapping.js");
const NSXCore = window.NSXCore;

// The `shot.elapsed` shape normalizeShotData passes through untouched.
const shot = (elapsed, pressure, flow, weightFlow) => ({
  elapsed, pressure, flow, weightFlow,
});

test("buildShotSparkline normalises against the fixed 0-12 scale, not the shot's own range", () => {
  const weak = NSXCore.buildShotSparkline(shot([0, 1, 2], [0, 3, 3], [0, 0, 0], [0, 0, 0]), { points: 3 });
  const strong = NSXCore.buildShotSparkline(shot([0, 1, 2], [0, 9, 9], [0, 0, 0], [0, 0, 0]), { points: 3 });
  assert.equal(weak.pressure[1], 0.25, "3 bar of a 12 bar scale");
  assert.equal(strong.pressure[1], 0.75, "9 bar of a 12 bar scale");
  assert.notEqual(weak.pressure[1], strong.pressure[1], "auto-scaling would make these identical");
});

test("buildShotSparkline clamps out-of-range samples instead of overflowing the box", () => {
  const s = NSXCore.buildShotSparkline(shot([0, 1], [-2, 30], [0, 0], [0, 0]), { points: 2 });
  assert.equal(s.pressure[0], 0);
  assert.equal(s.pressure[1], 1);
});

test("buildShotSparkline samples by TIME, so irregular spacing doesn't distort the curve", () => {
  // Nine samples bunched into the first second, one at t=10: sampling by index
  // would spend 90% of the width on the first second.
  const elapsed = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 10];
  const pressure = [0, 0, 0, 0, 0, 0, 0, 0, 0, 12];
  const s = NSXCore.buildShotSparkline(shot(elapsed, pressure, pressure.map(() => 0), pressure.map(() => 0)), { points: 3 });
  assert.deepEqual(s.pressure, [0, 0, 1], "the midpoint is t=5s — still in the flat stretch, not near the spike");
});

test("buildShotSparkline returns null when there is nothing to draw", () => {
  assert.equal(NSXCore.buildShotSparkline(null), null);
  assert.equal(NSXCore.buildShotSparkline({}), null, "a lightweight list shot carries no measurements");
  assert.equal(NSXCore.buildShotSparkline(shot([5], [3], [1], [0])), null, "a single sample is not a curve");
  assert.equal(NSXCore.buildShotSparkline(shot([0, 0], [3, 3], [1, 1], [0, 0])), null, "a zero-length shot has no x-axis");
});

test("buildShotSparkline emits exactly `points` values per series", () => {
  const s = NSXCore.buildShotSparkline(shot([0, 1, 2, 3], [1, 2, 3, 4], [1, 1, 1, 1], [0, 0, 1, 2]), { points: 12 });
  assert.equal(s.pressure.length, 12);
  assert.equal(s.flow.length, 12);
  assert.equal(s.weightFlow.length, 12);
});
