// Covers the profile-edit domain: normalize/build logic for a profile editor.
// Pure functions only — no DOM, no gateway calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/profile-edit.js");
const NSXCore = window.NSXCore;

const LIMITS_DEFAULT = {
  tankTempEnabled: false, tankTempValue: 0,
  stopWeightEnabled: false, stopWeightValue: 0,
  stopVolumeEnabled: false, stopVolumeValue: 0, stopVolumeStartIndex: 0,
  limiterFlowRange: 0.6, limiterPressureRange: 0.6,
};

test("isUserOwnedProfile: isDefault wins, then metadata.source", () => {
  assert.equal(NSXCore.isUserOwnedProfile({ isDefault: true }), false);
  assert.equal(NSXCore.isUserOwnedProfile({ metadata: { source: "user" } }), true);
  assert.equal(NSXCore.isUserOwnedProfile({ metadata: {} }), true, "no source = user-owned");
  assert.equal(NSXCore.isUserOwnedProfile({ metadata: { source: "visualizer" } }), false, "a non-empty, non-'user' source is not user-owned either");
});

// --- normalizeFrameExit ---

test("normalizeFrameExit: nested exit object wins over flattened fields", () => {
  const frame = {
    exit: { type: "flow", condition: "under", value: 1.5 },
    exit_if: false, // must NOT suppress the nested object's implied enabled=true
    exit_type: "pressure_over", exit_pressure_over: 99,
  };
  const exit = NSXCore.normalizeFrameExit(frame);
  assert.deepEqual(exit, { enabled: false, type: "flow_under", value: 1.5 },
    "type/value come from the nested object; exit_if (present) still governs enabled");
});

test("normalizeFrameExit: nested object with no exit_if present implies enabled", () => {
  const exit = NSXCore.normalizeFrameExit({ exit: { type: "pressure", condition: "over", value: 1.5 } });
  assert.deepEqual(exit, { enabled: true, type: "pressure_over", value: 1.5 });
});

test("normalizeFrameExit: falls back to flattened fields when no nested object", () => {
  const exit = NSXCore.normalizeFrameExit({ exit_if: true, exit_type: "flow_over", exit_flow_over: 2.5 });
  assert.deepEqual(exit, { enabled: true, type: "flow_over", value: 2.5 });
});

test("normalizeFrameExit: weight type", () => {
  const exit = NSXCore.normalizeFrameExit({ exit: { type: "weight", value: 40 } });
  assert.deepEqual(exit, { enabled: true, type: "weight", value: 40 });
});

test("normalizeFrameExit: no exit at all defaults to disabled pressure_over/0", () => {
  assert.deepEqual(NSXCore.normalizeFrameExit({}), { enabled: false, type: "pressure_over", value: 0 });
});

test("frameExitToObject: inverse mapping for all five types", () => {
  assert.deepEqual(NSXCore.frameExitToObject("pressure_over", 9), { type: "pressure", condition: "over", value: 9 });
  assert.deepEqual(NSXCore.frameExitToObject("pressure_under", 1.5), { type: "pressure", condition: "under", value: 1.5 });
  assert.deepEqual(NSXCore.frameExitToObject("flow_over", 2), { type: "flow", condition: "over", value: 2 });
  assert.deepEqual(NSXCore.frameExitToObject("flow_under", 0.5), { type: "flow", condition: "under", value: 0.5 });
  assert.deepEqual(NSXCore.frameExitToObject("weight", 40), { type: "weight", condition: "over", value: 40 });
});

// --- normalizeProfileFrame ---

test("normalizeProfileFrame: full round-trip of a real step shape", () => {
  const raw = {
    name: "Fill", pump: "pressure", transition: "fast",
    exit: { type: "pressure", condition: "over", value: 1.5 },
    volume: 100, seconds: 25, weight: 0, temperature: 93, sensor: "coffee",
    pressure: 2, limiter: null,
  };
  const f = NSXCore.normalizeProfileFrame(raw);
  assert.equal(f.name, "Fill");
  assert.equal(f.pump, "pressure");
  assert.equal(f.pressure, 2);
  assert.equal(f.seconds, 25);
  assert.equal(f.temperature, 93);
  assert.equal(f.sensor, "coffee");
  assert.equal(f.transition, "fast");
  assert.equal(f.volumeEnabled, true);
  assert.equal(f.volumeValue, 100);
  assert.equal(f.weightEnabled, false);
  assert.equal(f.limiterEnabled, false);
  assert.equal(f.exitEnabled, true);
  assert.equal(f.exitType, "pressure_over");
  assert.equal(f.exitValue, 1.5);
});

test("normalizeProfileFrame: strips profile-level fields that some profiles wrongly nest in a step", () => {
  const f = NSXCore.normalizeProfileFrame({
    name: "X", pressure: 9, seconds: 10, temperature: 93,
    tank_temperature: 80, target_volume: 40, target_volume_count_start: 1, target_weight: 36,
    someUnknownField: "keep-me",
  });
  assert.equal(f._rest.tank_temperature, undefined, "profile-level field must not leak into _rest");
  assert.equal(f._rest.target_volume, undefined);
  assert.equal(f._rest.target_volume_count_start, undefined);
  assert.equal(f._rest.target_weight, undefined);
  assert.equal(f._rest.someUnknownField, "keep-me", "genuinely unknown fields survive in _rest");
});

test("normalizeProfileFrame: defaults for a bare-minimum step", () => {
  const f = NSXCore.normalizeProfileFrame({ name: "X" });
  assert.equal(f.pump, "pressure");
  assert.equal(f.temperature, 93.0, "non-positive temperature falls back to 93");
  assert.equal(f.transition, "fast");
  assert.equal(f.sensor, "coffee");
  assert.equal(f.exitEnabled, false);
});

test("normalizeProfileFrame: an unset volume/weight cap reads as 0 (off), never a fabricated default", () => {
  const f = NSXCore.normalizeProfileFrame({ name: "X" });
  assert.equal(f.volumeEnabled, false);
  assert.equal(f.volumeValue, 0);
  assert.equal(f.weightEnabled, false);
  assert.equal(f.weightValue, 0);

  // A real per-step cap still comes through untouched.
  const g = NSXCore.normalizeProfileFrame({ name: "Y", volume: 40, weight: 18 });
  assert.deepEqual(
    [g.volumeEnabled, g.volumeValue, g.weightEnabled, g.weightValue],
    [true, 40, true, 18]
  );
});

test("normalizeProfileFrame: a profile-level target never leaks onto a frame", () => {
  // Some profiles wrongly nest these inside a step; they belong to the profile.
  const f = NSXCore.normalizeProfileFrame({ name: "X", target_weight: 36, target_volume: 40 });
  assert.equal(f.weightValue, 0);
  assert.equal(f.volumeValue, 0);
  assert.equal(f._rest.target_weight, undefined);
  assert.equal(f._rest.target_volume, undefined);
});

// --- hasDivergentLimiterRanges ---

test("hasDivergentLimiterRanges: false when every active limiter of a mode shares one range (the real-world case)", () => {
  const frames = [
    { pump: "pressure", limiter: { value: 6, range: 1 } },
    { pump: "pressure", limiter: { value: 4.5, range: 1 } },
  ];
  assert.equal(NSXCore.hasDivergentLimiterRanges(frames, "pressure"), false);
});

test("hasDivergentLimiterRanges: false with only one active limiter step (nothing to diverge against)", () => {
  // The exact shape of Baseline • Low Contact • 4 Bar: two disabled steps
  // (value 0) and one real one — a single real range, so no divergence.
  const frames = [
    { pump: "flow", limiter: { value: 0, range: 0 } },
    { pump: "flow", limiter: { value: 0, range: 0 } },
    { pump: "pressure", limiter: { value: 2.5, range: 3.5 } },
  ];
  assert.equal(NSXCore.hasDivergentLimiterRanges(frames, "pressure"), false);
  assert.equal(NSXCore.hasDivergentLimiterRanges(frames, "flow"), false);
});

test("hasDivergentLimiterRanges: true when two ACTIVE limiters of the same mode genuinely differ", () => {
  const frames = [
    { pump: "pressure", limiter: { value: 6, range: 1 } },
    { pump: "pressure", limiter: { value: 4.5, range: 2 } },
  ];
  assert.equal(NSXCore.hasDivergentLimiterRanges(frames, "pressure"), true);
});

test("hasDivergentLimiterRanges: a disabled step's stale range doesn't count as divergence", () => {
  const frames = [
    { pump: "pressure", limiter: { value: 6, range: 1 } },
    { pump: "pressure", limiter: { value: 0, range: 2 } }, // disabled — never written back, so irrelevant
  ];
  assert.equal(NSXCore.hasDivergentLimiterRanges(frames, "pressure"), false);
});

test("makeDefaultFrame: seeds from the previous frame, or sensible defaults for the first", () => {
  const first = NSXCore.makeDefaultFrame(null);
  assert.equal(first.pump, "pressure");
  assert.equal(first.seconds, 10);

  const seeded = NSXCore.makeDefaultFrame({ pump: "flow", flow: 3.5, temperature: 90, transition: "smooth", sensor: "water" });
  assert.equal(seeded.pump, "flow");
  assert.equal(seeded.flow, 3.5);
  assert.equal(seeded.temperature, 90);
  assert.equal(seeded.transition, "smooth");
  assert.equal(seeded.sensor, "water");
});

// --- normalizeProfileLimits ---

test("normalizeProfileLimits: reads profile-global fields with correct enabled/default logic", () => {
  const limits = NSXCore.normalizeProfileLimits({
    tank_temperature: 80, target_weight: 40, target_volume: 0,
    target_volume_count_start: 2, limiter_flow_range: 0.9, limiter_pressure_range: 1.2,
  });
  assert.deepEqual(limits, {
    tankTempEnabled: true, tankTempValue: 80,
    stopWeightEnabled: true, stopWeightValue: 40,
    stopVolumeEnabled: false, stopVolumeValue: 0,
    stopVolumeStartIndex: 2,
    limiterFlowRange: 0.9, limiterPressureRange: 1.2,
  });
});

test("normalizeProfileLimits: falls back to scanning per-frame limiter.range when no top-level range field exists", () => {
  // A real profile with no limiter_flow_range/limiter_pressure_range at all —
  // only per-frame limiter objects (pre-dates, or was never written through,
  // this editor's profile-global-range model).
  const profile = {
    steps: [
      { pump: "pressure", limiter: { value: 8, range: 0.9 } }, // pressure-pump limiter caps flow -> flow range
      { pump: "flow", limiter: { value: 6, range: 1.1 } }, // flow-pump limiter caps pressure -> pressure range
    ],
  };
  const limits = NSXCore.normalizeProfileLimits(profile, profile.steps);
  assert.equal(limits.limiterFlowRange, 0.9, "must not silently default to 0.6 and clobber the real per-frame range");
  assert.equal(limits.limiterPressureRange, 1.1);
});

test("normalizeProfileLimits: defaults for an empty/new profile", () => {
  assert.deepEqual(NSXCore.normalizeProfileLimits({}), LIMITS_DEFAULT);
  assert.deepEqual(NSXCore.normalizeProfileLimits(null), LIMITS_DEFAULT);
});

// --- buildProfileFromDraft ---

const ORIGINAL = {
  title: "Old Name", author: "Someone", notes: "old notes", version: "2",
  beverage_type: "espresso", groupTemp: 93,
  steps: [
    { name: "Fill", pump: "pressure", pressure: 2, seconds: 25, temperature: 93, sensor: "coffee", transition: "fast", exit: { type: "pressure", condition: "over", value: 1.5 } },
    { name: "Extraction", pump: "pressure", pressure: 9, seconds: 20, temperature: 93, sensor: "coffee", transition: "fast", limiter: { value: 2.0, range: 0.4 } },
  ],
};

function draftFromOriginal() {
  return {
    title: ORIGINAL.title, author: ORIGINAL.author, notes: ORIGINAL.notes, groupTemp: ORIGINAL.groupTemp,
    frames: ORIGINAL.steps.map((s) => NSXCore.normalizeProfileFrame(s)),
    limits: NSXCore.normalizeProfileLimits(ORIGINAL),
  };
}

test("buildProfileFromDraft: metadata-only edit preserves steps and bumps version", () => {
  const draft = draftFromOriginal();
  draft.title = "New Name";
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.equal(built.title, "New Name");
  assert.equal(built.author, "Someone");
  assert.equal(built.version, "3", "version bumps on every save");
  assert.equal(built.steps.length, 2);
  assert.equal(built.steps[0].pressure, 2);
  assert.deepEqual(built.steps[0].exit, { type: "pressure", condition: "over", value: 1.5 }, "nested exit shape preserved");
});

test("buildProfileFromDraft: draft.beverageType wins, is metadata (no execution change), falls back to original when absent", () => {
  const draft = draftFromOriginal();
  draft.beverageType = "cleaning";
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.equal(built.beverage_type, "cleaning");
  assert.equal(NSXCore.profileHasExecutionChanges(built, ORIGINAL), false, "beverage type is descriptive metadata");
  // draftFromOriginal() omits beverageType -> the original's value is kept.
  const kept = NSXCore.buildProfileFromDraft(draftFromOriginal(), ORIGINAL);
  assert.equal(kept.beverage_type, "espresso");
});

test("buildProfileFromDraft: preserves flow/pressure key shape against the original step", () => {
  const draft = draftFromOriginal();
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  // original step 0 had only `pressure`, no `flow` key at all
  assert.equal("pressure" in built.steps[0], true);
  assert.equal("flow" in built.steps[0], false, "no flow key should be invented for a pressure-only original step");
});

test("buildProfileFromDraft: enabling a frame's limiter uses the profile-global range for its pump's opposite axis", () => {
  const draft = draftFromOriginal();
  draft.frames[0].limiterEnabled = true;
  draft.frames[0].limiterValue = 8.0;
  draft.limits.limiterFlowRange = 0.9;
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  // frame 0's pump is "pressure" -> limiter caps flow -> uses limiterFlowRange
  assert.deepEqual(built.steps[0].limiter, { value: 8.0, range: 0.9 });
});

test("buildProfileFromDraft: disabling a frame's limiter preserves the original step's limiter verbatim", () => {
  const draft = draftFromOriginal();
  // frame 1's original had a limiter; the draft (normalized) reports it disabled
  // because normalizeProfileFrame reads limiterEnabled off limiter.value > 0 —
  // ORIGINAL's limiter.value is 2.0, so it actually normalizes as enabled.
  // Force it off to exercise the "keep the original's limiter untouched" path.
  draft.frames[1].limiterEnabled = false;
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.deepEqual(built.steps[1].limiter, { value: 2.0, range: 0.4 }, "untouched original limiter survives");
});

test("buildProfileFromDraft: a brand-new frame with no original step still gets flow/pressure per its own pump mode", () => {
  const draft = draftFromOriginal();
  const extra = NSXCore.makeDefaultFrame(draft.frames[draft.frames.length - 1]);
  extra.pump = "flow";
  extra.flow = 4.0;
  draft.frames.push(extra);
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.equal(built.steps.length, 3);
  assert.equal("flow" in built.steps[2], true);
  assert.equal(built.steps[2].flow, 4.0);
});

test("buildProfileFromDraft: mirrors into whichever of steps/frames the original used", () => {
  const legacyOriginal = { ...ORIGINAL, frames: ORIGINAL.steps, steps: undefined };
  delete legacyOriginal.steps;
  const draft = {
    title: "T", author: "", notes: "", groupTemp: 93,
    frames: legacyOriginal.frames.map((s) => NSXCore.normalizeProfileFrame(s)),
    limits: NSXCore.normalizeProfileLimits(legacyOriginal),
  };
  const built = NSXCore.buildProfileFromDraft(draft, legacyOriginal);
  assert.equal(Array.isArray(built.frames), true);
  assert.equal(built.steps, undefined);
});

test("buildProfileFromDraft: a brand-new profile (no original) defaults to `steps` and version '2'", () => {
  const draft = {
    title: "Fresh", author: "", notes: "", groupTemp: 93,
    frames: [NSXCore.makeDefaultFrame(null)],
    limits: NSXCore.normalizeProfileLimits(null),
  };
  const built = NSXCore.buildProfileFromDraft(draft, null);
  assert.equal(Array.isArray(built.steps), true);
  assert.equal(built.version, "2");
});

// --- profileHasExecutionChanges ---

test("profileHasExecutionChanges: false for a metadata-only edit", () => {
  const draft = draftFromOriginal();
  draft.title = "New Name";
  draft.author = "New Author";
  draft.notes = "New notes";
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.equal(NSXCore.profileHasExecutionChanges(built, ORIGINAL), false);
});

test("profileHasExecutionChanges: true when a frame changes", () => {
  const draft = draftFromOriginal();
  draft.frames[0].pressure = 3;
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.equal(NSXCore.profileHasExecutionChanges(built, ORIGINAL), true);
});

test("profileHasExecutionChanges: true when a limits-tab field changes (not just frames)", () => {
  const draft = draftFromOriginal();
  draft.limits.tankTempEnabled = true;
  draft.limits.tankTempValue = 85;
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.equal(NSXCore.profileHasExecutionChanges(built, ORIGINAL), true, "tank temp is an execution field, not metadata");
});

test("buildProfileFromDraft: writes profile-global limits fields", () => {
  const draft = draftFromOriginal();
  draft.limits.tankTempEnabled = true;
  draft.limits.tankTempValue = 85;
  draft.limits.stopWeightEnabled = true;
  draft.limits.stopWeightValue = 36;
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.equal(built.tank_temperature, 85);
  assert.equal(built.target_weight, 36);
  assert.equal(built.target_volume, 0);
});
