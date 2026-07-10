// Covers the mapping domain — the stateless "domain model" layer every skin
// shares: formatters, workflow keys, and shot normalization.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/mapping.js");
const NSXCore = window.NSXCore;

test("formatMmSs rounds up to the next whole second and pads", () => {
  assert.equal(NSXCore.formatMmSs(0), "0:00");
  assert.equal(NSXCore.formatMmSs(1000), "0:01");
  assert.equal(NSXCore.formatMmSs(1001), "0:02", "partial seconds round up");
  assert.equal(NSXCore.formatMmSs(65_000), "1:05");
  assert.equal(NSXCore.formatMmSs(-500), "0:00", "negatives clamp to zero");
});

test("calcRatio formats a brew ratio and guards a zero dose", () => {
  assert.equal(NSXCore.calcRatio(18, 36), "1:2.0");
  assert.equal(NSXCore.calcRatio(20, 45), "1:2.3");
  assert.equal(NSXCore.calcRatio(0, 36), "—");
});

test("getWorkflowKey lowercases parts and falls back to em-dash", () => {
  const key = NSXCore.getWorkflowKey({
    coffeeRoaster: "Roaster",
    coffeeName: "Bean",
    grinderModel: "Grinder",
    profileTitle: "Profile",
  });
  assert.equal(key, "roaster||bean||grinder||profile");
  assert.equal(NSXCore.getWorkflowKey({}), "—||—||—||—");
  assert.equal(NSXCore.getWorkflowKey(null), "—||—||—||—");
});

test("getWorkflowKey is case-insensitive (same recipe from different casings)", () => {
  const a = NSXCore.getWorkflowKey({ coffeeRoaster: "ACME", coffeeName: "Yirg" });
  const b = NSXCore.getWorkflowKey({ coffeeRoaster: "acme", coffeeName: "yirg" });
  assert.equal(a, b);
});

test("normalizeShotData rebases elapsed to zero and synthesizes a scaleRate", () => {
  const out = NSXCore.normalizeShotData({ elapsed: [10, 11, 12.5] });
  assert.deepEqual(out.elapsed, [0, 1, 2.5]);
  assert.deepEqual(out.scaleRate, [0, 0, 0], "missing scale data becomes zeros of equal length");
});

test("normalizeShotData returns null without usable data", () => {
  assert.equal(NSXCore.normalizeShotData(null), null);
  assert.equal(NSXCore.normalizeShotData({}), null, "no elapsed and no measurements");
});

test("getShotDurationSeconds returns the rebased final elapsed value", () => {
  assert.equal(NSXCore.getShotDurationSeconds({ elapsed: [5, 6, 8] }), 3);
  assert.equal(NSXCore.getShotDurationSeconds({}), null);
});

test("computeMaxRating reports the top rating and how many shots share it", () => {
  const shots = [
    { annotations: { enjoyment: 3 } },
    { annotations: { enjoyment: 5 } },
    { annotations: { enjoyment: 5 } },
    { annotations: {} },
  ];
  assert.deepEqual(NSXCore.computeMaxRating(shots), { max: 5, count: 2 });
  assert.deepEqual(NSXCore.computeMaxRating([]), { max: null, count: 0 });
});

test("computeMaxRating falls back to the legacy metadata.rating field", () => {
  assert.deepEqual(NSXCore.computeMaxRating([{ metadata: { rating: 4 } }]), { max: 4, count: 1 });
});
