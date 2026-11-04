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

test("enjoymentToStars converts the real 0-10 API scale to 0-5 stars, clamped", () => {
  assert.equal(NSXCore.enjoymentToStars(10), 5);
  assert.equal(NSXCore.enjoymentToStars(8), 4);
  assert.equal(NSXCore.enjoymentToStars(5), 3, "rounds to the nearest star");
  assert.equal(NSXCore.enjoymentToStars(0), 0);
  assert.equal(NSXCore.enjoymentToStars(null), 0);
  assert.equal(NSXCore.enjoymentToStars(undefined), 0);
  // The crash that started this: any value above 5 used to make a 1-5 skin do
  // '☆'.repeat(negative) and throw a RangeError, blanking the whole view.
  assert.equal(NSXCore.enjoymentToStars(100), 5, "clamps rather than exceeding 5 stars");
  assert.equal(NSXCore.enjoymentToStars(-10), 0, "clamps negatives to 0");
});

test("starsToEnjoyment converts stars back to the 0-10 value the API stores", () => {
  assert.equal(NSXCore.starsToEnjoyment(5), 10);
  assert.equal(NSXCore.starsToEnjoyment(3), 6);
  assert.equal(NSXCore.starsToEnjoyment(0), 0);
  assert.equal(NSXCore.starsToEnjoyment(9), 10, "clamps above 5 stars — the gateway rejects > 10");
});

test("enjoyment/stars conversion round-trips every whole star", () => {
  for (let stars = 0; stars <= 5; stars++) {
    assert.equal(NSXCore.enjoymentToStars(NSXCore.starsToEnjoyment(stars)), stars);
  }
});

test("enjoymentToPercent / percentToEnjoyment map 0-10 onto 0-100 and keep 'unrated' null", () => {
  assert.equal(NSXCore.enjoymentToPercent(10), 100);
  assert.equal(NSXCore.enjoymentToPercent(7), 70);
  assert.equal(NSXCore.enjoymentToPercent(0), 0);
  assert.equal(NSXCore.enjoymentToPercent(null), null);
  assert.equal(NSXCore.enjoymentToPercent(80), 100, "clamps a stray 0-100 value");
  assert.equal(NSXCore.percentToEnjoyment(100), 10);
  assert.equal(NSXCore.percentToEnjoyment(70), 7);
  assert.equal(NSXCore.percentToEnjoyment(null), null);
  assert.equal(NSXCore.percentToEnjoyment(150), 10, "never above what the gateway accepts");
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

// A shot as the gateway records it: per-sample counted volume (top-level
// `volume`, 0 until the profile's count-start step) and scale weight.
const volumeShot = (pairs) => ({ measurements: pairs.map(([volume, weight]) => ({ volume, scale: { weight } })) });

// Counting starts in the infusion: 12 ml are counted before the first drops,
// then volume and weight rise 1:1 — the shape that made the old single ratio
// (48/36 = 1.33, and 2+ on finer grinds) useless at any other target weight.
const EARLY_COUNT = volumeShot([[0, 0], [5, 0], [12, 0], [13, 1], [25, 13], [48, 36]]);
// Counting starts after the first drops: 6 g are already in the cup.
const LATE_COUNT = volumeShot([[0, 0], [0, 2], [0, 6], [1, 6.9], [15, 21], [30, 36]]);

test("updateVolumeCalibration learns factor and offset apart", () => {
  const cal = NSXCore.updateVolumeCalibration(null, EARLY_COUNT);
  assert.ok(Math.abs(cal.factor - 1.0) < 1e-9, "35 ml over 35 g after the first drops");
  assert.ok(Math.abs(cal.offset - 12) < 1e-9, "the 12 ml counted before the cup");
  assert.deepEqual(cal.samples.length, 1);
  assert.deepEqual(cal.offsets.length, 1);
});

test("updateVolumeCalibration: a late count start is a negative offset", () => {
  const cal = NSXCore.updateVolumeCalibration(null, LATE_COUNT);
  assert.ok(cal.offset < -5 && cal.offset > -8, `offset ${cal.offset}`);
  assert.ok(Math.abs(NSXCore.volumeForYield(36, cal) - 30) <= 1, "stops where this shot stopped");
});

test("updateVolumeCalibration averages a rolling 4-shot window of both numbers", () => {
  let cal = null;
  for (let i = 0; i < 5; i++) cal = NSXCore.updateVolumeCalibration(cal, EARLY_COUNT);
  assert.equal(cal.samples.length, 4);
  assert.equal(cal.offsets.length, 4);
});

test("updateVolumeCalibration replaces an old ratio-only calibration instead of averaging into it", () => {
  const cal = NSXCore.updateVolumeCalibration({ factor: 1.33, samples: [1.3, 1.36] }, EARLY_COUNT);
  assert.equal(cal.samples.length, 1, "old ratio samples include the offset — not comparable");
  assert.ok(Math.abs(cal.factor - 1.0) < 1e-9);
});

test("updateVolumeCalibration rejects an implausible shot and returns cal unchanged", () => {
  const cal = { factor: 1.0, offset: 0, samples: [1.0], offsets: [0] };
  // 90 ml for 10 g after the drops: a factor of 9, not a coffee
  assert.strictEqual(NSXCore.updateVolumeCalibration(cal, volumeShot([[1, 1], [90, 11]])), cal);
  // too little volume
  assert.strictEqual(NSXCore.updateVolumeCalibration(cal, volumeShot([[1, 1], [3, 3]])), cal);
  // weight barely moved after the reference point — no usable slope
  assert.strictEqual(NSXCore.updateVolumeCalibration(cal, volumeShot([[10, 1], [20, 4]])), cal);
});

test("volumeForYield / yieldForVolume are inverse, offset included", () => {
  const cal = { factor: 1.05, offset: 9 };
  assert.equal(NSXCore.volumeForYield(36, cal), 47, "round(9 + 36 * 1.05)");
  assert.ok(Math.abs(NSXCore.yieldForVolume(9 + 36 * 1.05, cal) - 36) < 1e-9);
  assert.equal(NSXCore.yieldForVolume(5, cal), 0, "nothing in the cup before the offset is counted");
  assert.equal(NSXCore.volumeForYield(0, cal), 0);
  assert.equal(NSXCore.volumeForYield(36, null), 36, "uncalibrated: 1 ml per g");
});

test("resolveVolumeCalibration: own, then legacy, then the profile's mean, then 1:1", () => {
  const learned = (factor, offset) => ({ factor, offset, samples: [factor], offsets: [offset] });
  const a = { id: "a", profileTitle: "Londonium", volumeCalibration: learned(1.0, 2) };
  const b = { id: "b", profileTitle: "londonium ", volumeCalibration: learned(1.1, -6) };
  const other = { id: "c", profileTitle: "Adaptive", volumeCalibration: learned(1.4, 30) };
  const fresh = { id: "n", profileTitle: "Londonium", volumeCalibration: { factor: 1.0, samples: [] } };
  const all = [a, b, other, fresh];

  assert.deepEqual(NSXCore.resolveVolumeCalibration(a, all), { factor: 1.0, offset: 2, source: "recipe", count: 1 });
  const pooled = NSXCore.resolveVolumeCalibration(fresh, all);
  assert.equal(pooled.source, "profile");
  assert.equal(pooled.count, 2, "only the same profile, case-insensitively");
  assert.ok(Math.abs(pooled.factor - 1.05) < 1e-9);
  assert.ok(Math.abs(pooled.offset - -2) < 1e-9);

  const legacy = { id: "l", profileTitle: "Londonium", volumeCalibration: { factor: 1.3, samples: [1.3] } };
  assert.equal(NSXCore.resolveVolumeCalibration(legacy, all).source, "legacy");
  assert.deepEqual(NSXCore.resolveVolumeCalibration(fresh, [fresh]), { factor: 1.0, offset: 0, source: "default", count: 0 });
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

/* ── uniqueFieldValuesByRecency ─────────────────────────── */

const bean = (roaster, createdAt, extra = {}) => ({ roaster, createdAt, ...extra });

test("uniqueFieldValuesByRecency orders values by their newest createdAt", () => {
  const beans = [
    bean("Zulu Beans",    "2026-01-01T10:00:00"),
    bean("Bravo Roasters", "2026-08-29T17:44:26"),
    bean("Alpha Coffee",   "2026-08-29T18:22:02"),
  ];
  assert.deepEqual(
    NSXCore.uniqueFieldValuesByRecency(beans, "roaster"),
    ["Alpha Coffee", "Bravo Roasters", "Zulu Beans"],
    "newest first, not alphabetical",
  );
});

test("uniqueFieldValuesByRecency dedupes on the newest occurrence", () => {
  const beans = [
    bean("Zulu Beans",    "2026-01-01T10:00:00"),
    bean("Bravo Roasters", "2026-02-01T10:00:00"),
    bean("Zulu Beans",    "2026-09-01T10:00:00"),
  ];
  assert.deepEqual(
    NSXCore.uniqueFieldValuesByRecency(beans, "roaster"),
    ["Zulu Beans", "Bravo Roasters"],
    "a roaster reused on a newer bean moves to the front",
  );
});

test("uniqueFieldValuesByRecency ranks undated items behind dated ones, in order", () => {
  const beans = [
    bean("NoDateFirst",  undefined),
    bean("NoDateSecond", undefined),
    bean("Dated",        "2020-01-01T00:00:00"),
  ];
  assert.deepEqual(
    NSXCore.uniqueFieldValuesByRecency(beans, "roaster"),
    ["Dated", "NoDateFirst", "NoDateSecond"],
    "even an old dated item outranks undated ones, which keep their order",
  );
});

test("uniqueFieldValuesByRecency drops empty values and trims", () => {
  const beans = [
    bean("  Alpha Coffee  ", "2026-03-01T00:00:00"),
    bean("",          "2026-04-01T00:00:00"),
    bean(null,        "2026-05-01T00:00:00"),
    bean("   ",       "2026-06-01T00:00:00"),
  ];
  assert.deepEqual(NSXCore.uniqueFieldValuesByRecency(beans, "roaster"), ["Alpha Coffee"]);
});

test("uniqueFieldValuesByRecency reads dotted paths and array fields", () => {
  const profiles = [
    { createdAt: "2026-01-01T00:00:00", profile: { title: "Old" } },
    { createdAt: "2026-09-01T00:00:00", profile: { title: "New" } },
  ];
  assert.deepEqual(
    NSXCore.uniqueFieldValuesByRecency(profiles, "profile.title"),
    ["New", "Old"],
  );

  const withVariety = [
    bean("r1", "2026-01-01T00:00:00", { variety: ["Bourbon", "Typica"] }),
    bean("r2", "2026-09-01T00:00:00", { variety: ["Catuai"] }),
  ];
  assert.deepEqual(
    NSXCore.uniqueFieldValuesByRecency(withVariety, "variety"),
    ["Catuai", "Bourbon", "Typica"],
    "every entry of an array field is contributed under its item's date",
  );
});

test("uniqueFieldValuesByRecency accepts a picker function and tolerates junk", () => {
  const profiles = [
    { createdAt: "2026-01-01T00:00:00", profile: { steps: [{ name: "Preinfuse" }] } },
    { createdAt: "2026-09-01T00:00:00", profile: { steps: [{ name: "Pour" }, { name: "Preinfuse" }] } },
  ];
  // Both names occur in the newest profile, so they tie on rank and the sort
  // is stable: they keep the order they were first encountered in.
  assert.deepEqual(
    NSXCore.uniqueFieldValuesByRecency(profiles, (p) => (p.profile?.steps ?? []).map((s) => s.name)),
    ["Preinfuse", "Pour"],
  );

  assert.deepEqual(NSXCore.uniqueFieldValuesByRecency(null, "roaster"), []);
  assert.deepEqual(NSXCore.uniqueFieldValuesByRecency(undefined, "roaster"), []);
  assert.deepEqual(
    NSXCore.uniqueFieldValuesByRecency([{ createdAt: "nonsense", roaster: "X" }], "roaster"),
    ["X"],
    "an unparseable date must not drop the value",
  );
});

/* ── rankSuggestions ────────────────────────────────────── */

test("rankSuggestions puts a prefix match ahead of a mid-word one", () => {
  // The reported case: typing "ris" must offer Risteriet, not Kristians Kaffe.
  const roasters = ["Kristians Kaffe", "Risteriet"];
  assert.deepEqual(
    NSXCore.rankSuggestions(roasters, "ris"),
    ["Risteriet", "Kristians Kaffe"],
  );
});

test("rankSuggestions ranks a word-start above a mid-word match", () => {
  const values = ["Unkaffee", "Kristians Kaffe", "Kaffeine"];
  assert.deepEqual(
    NSXCore.rankSuggestions(values, "kaf"),
    ["Kaffeine", "Kristians Kaffe", "Unkaffee"],
    "whole-string prefix, then word prefix, then merely contains",
  );
});

test("rankSuggestions keeps mid-word matches rather than dropping them", () => {
  assert.deepEqual(
    NSXCore.rankSuggestions(["Kristians Kaffe"], "stian"),
    ["Kristians Kaffe"],
    "half-remembering the middle of a name still finds it",
  );
  assert.deepEqual(NSXCore.rankSuggestions(["Risteriet"], "zzz"), []);
});

test("rankSuggestions preserves the incoming order within a tier", () => {
  // Upstream order is recency (uniqueFieldValuesByRecency), and it must survive
  // as the tiebreak so the newest of two equally good matches stays first.
  const values = ["Kaffe Neu", "Kaffe Alt"];
  assert.deepEqual(NSXCore.rankSuggestions(values, "kaffe"), ["Kaffe Neu", "Kaffe Alt"]);
});

test("rankSuggestions is case-insensitive and ignores surrounding whitespace", () => {
  assert.deepEqual(NSXCore.rankSuggestions(["Risteriet"], "  RIS "), ["Risteriet"]);
});

test("rankSuggestions treats punctuation as a word break", () => {
  assert.deepEqual(
    NSXCore.rankSuggestions(["Bönor-Röstare", "Xbonor"], "rö"),
    ["Bönor-Röstare"],
    "a hyphen starts a new word; accented letters count as letters",
  );
});

test("rankSuggestions returns everything for an empty query, and tolerates junk", () => {
  const values = ["A", "B"];
  assert.deepEqual(NSXCore.rankSuggestions(values, ""), values);
  assert.deepEqual(NSXCore.rankSuggestions(values, "   "), values);
  assert.deepEqual(NSXCore.rankSuggestions(values, null), values);
  assert.deepEqual(NSXCore.rankSuggestions(null, "a"), []);
});
