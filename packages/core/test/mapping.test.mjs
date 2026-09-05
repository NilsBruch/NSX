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

test("enjoymentToStars converts the real 0-100 API scale to 0-5 stars, clamped", () => {
  assert.equal(NSXCore.enjoymentToStars(100), 5);
  assert.equal(NSXCore.enjoymentToStars(80), 4);
  assert.equal(NSXCore.enjoymentToStars(50), 3, "rounds to the nearest star");
  assert.equal(NSXCore.enjoymentToStars(0), 0);
  assert.equal(NSXCore.enjoymentToStars(null), 0);
  assert.equal(NSXCore.enjoymentToStars(undefined), 0);
  // The crash that started this: any value above 5 used to make a 1-5 skin do
  // '☆'.repeat(negative) and throw a RangeError, blanking the whole view.
  assert.equal(NSXCore.enjoymentToStars(999), 5, "clamps rather than exceeding 5 stars");
  assert.equal(NSXCore.enjoymentToStars(-10), 0, "clamps negatives to 0");
});

test("starsToEnjoyment converts stars back to the 0-100 value the API stores", () => {
  assert.equal(NSXCore.starsToEnjoyment(5), 100);
  assert.equal(NSXCore.starsToEnjoyment(3), 60);
  assert.equal(NSXCore.starsToEnjoyment(0), 0);
  assert.equal(NSXCore.starsToEnjoyment(9), 100, "clamps above 5 stars");
});

test("enjoyment/stars conversion round-trips every whole star", () => {
  for (let stars = 0; stars <= 5; stars++) {
    assert.equal(NSXCore.enjoymentToStars(NSXCore.starsToEnjoyment(stars)), stars);
  }
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

test("resolveActualDose prefers a recorded annotation over the planned target", () => {
  const shot = { annotations: { actualDoseWeight: 19.2 }, workflow: { context: { targetDoseWeight: 18 } } };
  assert.equal(NSXCore.resolveActualDose(shot), 19.2);
});

test("resolveActualDose falls back to the recipe target with no annotation, then to null", () => {
  assert.equal(NSXCore.resolveActualDose({ workflow: { context: { targetDoseWeight: 18 } } }), 18);
  assert.equal(NSXCore.resolveActualDose({}), null);
  assert.equal(NSXCore.resolveActualDose({ annotations: { actualDoseWeight: 0 } }), null, "a zero annotation is not a real measurement");
});

test("resolveActualYield prefers an actualYield annotation (top-level or nested in extras)", () => {
  assert.deepEqual(NSXCore.resolveActualYield({ annotations: { actualYield: 36.5 } }), { value: 36.5, unit: "g", estimated: false });
  assert.deepEqual(NSXCore.resolveActualYield({ annotations: { extras: { actualYield: 40 } } }), { value: 40, unit: "g", estimated: false });
});

test("resolveActualYield falls back to the machine's own volume snapshot (ml)", () => {
  assert.deepEqual(NSXCore.resolveActualYield({ snapshot: { volume: 42 } }), { value: 42, unit: "ml", estimated: false });
});

test("resolveActualYield falls back to the last nonzero scale-weight sample", () => {
  const fullShot = { measurements: [{ scale: { weight: 0 } }, { scale: { weight: 30 } }, { scale: { weight: 0 } }] };
  assert.deepEqual(NSXCore.resolveActualYield(fullShot), { value: 30, unit: "g", estimated: false });
});

test("resolveActualYield falls back to a virtual-scale estimate, flagged as estimated", () => {
  const fullShot = { annotations: { extras: { virtualScale: true, actualYield: 33 } } };
  assert.deepEqual(NSXCore.resolveActualYield(fullShot), { value: 33, unit: "g", estimated: true });
});

test("resolveActualYield returns a null value with nothing to resolve", () => {
  assert.deepEqual(NSXCore.resolveActualYield({}), { value: null, unit: "g", estimated: false });
});

test("resolveShotVolumeAndWeight reads the last nonzero sample of each from measurements", () => {
  const fullShot = {
    measurements: [
      { scale: { weight: 0 }, machine: { volume: 0 } },
      { scale: { weight: 18 }, machine: { volume: 20 } },
      { scale: { weight: 0 }, machine: { volume: 0 } },
    ],
  };
  assert.deepEqual(NSXCore.resolveShotVolumeAndWeight(fullShot), { volume: 20, weight: 18 });
});

test("resolveShotVolumeAndWeight falls back to the volume snapshot with no per-sample volume", () => {
  assert.deepEqual(
    NSXCore.resolveShotVolumeAndWeight({ measurements: [{ scale: { weight: 18 } }], snapshot: { volume: 20 } }),
    { volume: 20, weight: 18 }
  );
});

test("updateVolumeCalibration learns a new sample and averages a rolling 4-sample window", () => {
  const fullShot = { measurements: [{ scale: { weight: 18 }, machine: { volume: 18 } }] }; // ratio 1.0
  const cal = NSXCore.updateVolumeCalibration({ factor: 1.0, samples: [0.9, 0.95] }, fullShot);
  assert.deepEqual(cal.samples, [0.9, 0.95, 1.0]);
  assert.ok(Math.abs(cal.factor - (0.9 + 0.95 + 1.0) / 3) < 1e-9);
});

test("updateVolumeCalibration keeps only the last 4 samples", () => {
  const fullShot = { measurements: [{ scale: { weight: 20 }, machine: { volume: 20 } }] }; // ratio 1.0
  const cal = NSXCore.updateVolumeCalibration({ factor: 1.0, samples: [0.6, 0.7, 0.8, 0.9] }, fullShot);
  assert.deepEqual(cal.samples, [0.7, 0.8, 0.9, 1.0]);
});

test("updateVolumeCalibration rejects an implausible sample (ratio out of 0.5-1.5) and returns cal unchanged", () => {
  const fullShot = { measurements: [{ scale: { weight: 10 }, machine: { volume: 90 } }] }; // ratio 9.0
  const cal = { factor: 1.0, samples: [1.0] };
  assert.strictEqual(NSXCore.updateVolumeCalibration(cal, fullShot), cal);
});

test("updateVolumeCalibration rejects too little volume even with a plausible ratio", () => {
  const fullShot = { measurements: [{ scale: { weight: 3 }, machine: { volume: 3 } }] }; // ratio 1.0, but volume < 5
  const cal = { factor: 1.0, samples: [] };
  assert.strictEqual(NSXCore.updateVolumeCalibration(cal, fullShot), cal);
});

test("updateVolumeCalibration is a no-op without both a real weight and volume sample", () => {
  const cal = { factor: 1.0, samples: [] };
  assert.strictEqual(NSXCore.updateVolumeCalibration(cal, { measurements: [{ scale: { weight: 18 } }] }), cal);
  assert.strictEqual(NSXCore.updateVolumeCalibration(cal, {}), cal);
});

// --- sortRecipesByLastUsed: the recipe library's "most recently brewed first" order ---

const recipeOf = (coffeeName, profileTitle = "Blooming") => ({
  id: coffeeName, coffeeRoaster: "Roaster", coffeeName, grinderModel: "Niche", profileTitle,
});
const shotOf = (coffeeName, timestamp, profileTitle = "Blooming") => ({
  timestamp,
  workflow: {
    profile: { title: profileTitle },
    context: { coffeeRoaster: "Roaster", coffeeName, grinderModel: "Niche" },
  },
});

test("sortRecipesByLastUsed puts the most recently brewed recipe first", () => {
  const recipes = [recipeOf("A"), recipeOf("B"), recipeOf("C")];
  const shots = [
    shotOf("A", "2026-07-01T08:00:00Z"),
    shotOf("C", "2026-07-10T08:00:00Z"),
    shotOf("B", "2026-07-05T08:00:00Z"),
    shotOf("A", "2026-07-02T08:00:00Z"), // A's newest shot is what counts
  ];
  assert.deepEqual(NSXCore.sortRecipesByLastUsed(recipes, shots).map((r) => r.id), ["C", "B", "A"]);
});

test("sortRecipesByLastUsed keeps never-brewed recipes at the end in their original order", () => {
  const recipes = [recipeOf("New1"), recipeOf("A"), recipeOf("New2")];
  const shots = [shotOf("A", "2026-07-01T08:00:00Z")];
  assert.deepEqual(NSXCore.sortRecipesByLastUsed(recipes, shots).map((r) => r.id), ["A", "New1", "New2"]);
});

test("sortRecipesByLastUsed matches on the full workflow key, not just the bean", () => {
  const recipes = [recipeOf("A", "Blooming"), recipeOf("A", "Extractamundo")];
  const shots = [shotOf("A", "2026-07-10T08:00:00Z", "Extractamundo")];
  const sorted = NSXCore.sortRecipesByLastUsed(recipes, shots);
  assert.equal(sorted[0].profileTitle, "Extractamundo", "only the brewed profile's recipe is dated");
});

test("sortRecipesByLastUsed tolerates empty/missing inputs", () => {
  assert.deepEqual(NSXCore.sortRecipesByLastUsed([], []), []);
  assert.deepEqual(NSXCore.sortRecipesByLastUsed(undefined, undefined), []);
  assert.deepEqual(NSXCore.sortRecipesByLastUsed([recipeOf("A")], undefined).map((r) => r.id), ["A"]);
});

test("getShotStopReason returns the persisted reason, null for legacy/missing, and classifies the open set", () => {
  assert.equal(NSXCore.getShotStopReason({ stopReason: "targetWeight" }), "targetWeight");
  assert.equal(NSXCore.getShotStopReason({ stopReason: "" }), null, "empty string is treated as no reason");
  assert.equal(NSXCore.getShotStopReason({}), null, "legacy/un-sequenced shot has no reason");
  assert.equal(NSXCore.getShotStopReason(null), null);
  // Open set: a value from a newer build is returned as-is but not "known".
  assert.equal(NSXCore.getShotStopReason({ stopReason: "someFutureReason" }), "someFutureReason");
  assert.equal(NSXCore.isKnownStopReason("targetVolume"), true);
  assert.equal(NSXCore.isKnownStopReason("someFutureReason"), false);
  assert.equal(NSXCore.isKnownStopReason(null), false);
});
