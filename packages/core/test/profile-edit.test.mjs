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

// --- per-frame limiter range ---

test("normalizeProfileFrame: a step keeps its OWN limiter range", () => {
  // The shape nine of 73 profiles on a real machine have: two steps that limit
  // with different ranges. One range for the whole profile rewrote the other.
  const soft = NSXCore.normalizeProfileFrame({ pump: "flow", limiter: { value: 3, range: 0.6 } });
  const hard = NSXCore.normalizeProfileFrame({ pump: "pressure", limiter: { value: 2.5, range: 3.5 } });
  assert.equal(soft.limiterRange, 0.6);
  assert.equal(hard.limiterRange, 3.5);
});

test("normalizeProfileFrame: range 0 is a real value, an ABSENT range is what defaults", () => {
  // Decent's Baseline profiles use range 0 for a hard limit — defaulting that
  // to 0.6 would soften a limiter the profile means to be abrupt.
  const zero = NSXCore.normalizeProfileFrame({ pump: "pressure", limiter: { value: 6, range: 0 } });
  assert.equal(zero.limiterRange, 0);
  const missing = NSXCore.normalizeProfileFrame({ pump: "pressure", limiter: { value: 6 } });
  assert.equal(missing.limiterRange, 0.6);
  const none = NSXCore.normalizeProfileFrame({ pump: "pressure" });
  assert.equal(none.limiterRange, 0.6, "a step with no limiter still needs a value for the control");
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

test("makeDefaultFrame carries HOW the step runs — duration and limiter included", () => {
  // These used to reset, so every added step began by re-entering a duration
  // and a limiter that were already right on the step before it.
  const prev = {
    pump: "flow", flow: 2.2, seconds: 25, temperature: 88,
    limiterEnabled: true, limiterValue: 6, limiterRange: 1.2,
  };
  const next = NSXCore.makeDefaultFrame(prev);
  assert.equal(next.seconds, 25);
  assert.equal(next.limiterEnabled, true);
  assert.equal(next.limiterValue, 6);
  assert.equal(next.limiterRange, 1.2);
});

test("makeDefaultFrame does NOT carry how the step ENDS", () => {
  // The caps and the exit are what tell one step from the next: a weight cap
  // inherited onto the following step would end it at a total nobody asked
  // for. It is also the line that keeps Add and Duplicate different buttons.
  const prev = {
    name: "Preinfusion",
    volumeEnabled: true, volumeValue: 30,
    weightEnabled: true, weightValue: 36,
    exitEnabled: true, exitType: "pressure_over", exitValue: 4,
  };
  const next = NSXCore.makeDefaultFrame(prev);
  assert.equal(next.name, "", "a new step is not the same step");
  assert.equal(next.volumeEnabled, false);
  assert.equal(next.volumeValue, 0);
  assert.equal(next.weightEnabled, false);
  assert.equal(next.weightValue, 0);
  assert.equal(next.exitEnabled, false);
  assert.equal(next.exitValue, 0);
});

// --- normalizeProfileLimits ---

test("normalizeProfileLimits: reads the profile-wide fields, and only those", () => {
  const limits = NSXCore.normalizeProfileLimits({
    tank_temperature: 80, target_weight: 40, target_volume: 0,
    target_volume_count_start: 2, limiter_flow_range: 0.9, limiter_pressure_range: 1.2,
  });
  assert.deepEqual(limits, {
    tankTempEnabled: true, tankTempValue: 80,
    stopWeightEnabled: true, stopWeightValue: 40,
    stopVolumeEnabled: false, stopVolumeValue: 0,
    stopVolumeStartIndex: 2,
  }, "the limiter ranges belong to the frames now, not here");
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

test("buildProfileFromDraft: a frame's limiter is written with that frame's own range", () => {
  const draft = draftFromOriginal();
  draft.frames[0].limiterEnabled = true;
  draft.frames[0].limiterValue = 8.0;
  draft.frames[0].limiterRange = 0.9;
  draft.frames[1].limiterEnabled = true;
  draft.frames[1].limiterValue = 2.5;
  draft.frames[1].limiterRange = 3.5;
  const built = NSXCore.buildProfileFromDraft(draft, ORIGINAL);
  assert.deepEqual(built.steps[0].limiter, { value: 8.0, range: 0.9 });
  assert.deepEqual(built.steps[1].limiter, { value: 2.5, range: 3.5 }, "the second range survives the first");
});

test("buildProfileFromDraft: a profile with two different limiter ranges round-trips untouched", () => {
  // The regression in one line: open a profile like Soup 58 (ranges 3 and 5),
  // save it without touching anything, and both steps used to come back with
  // whichever range was seen first.
  const varied = {
    title: "Soup 58", version: "2",
    steps: [
      { name: "a", pump: "pressure", pressure: 6, seconds: 10, temperature: 93, sensor: "coffee", limiter: { value: 3, range: 3 } },
      { name: "b", pump: "pressure", pressure: 4, seconds: 20, temperature: 93, sensor: "coffee", limiter: { value: 2, range: 5 } },
    ],
  };
  const draft = {
    title: varied.title, author: "", notes: "", beverageType: "espresso", groupTemp: 93,
    frames: varied.steps.map(NSXCore.normalizeProfileFrame),
    limits: NSXCore.normalizeProfileLimits(varied),
  };
  const built = NSXCore.buildProfileFromDraft(draft, varied);
  assert.deepEqual(built.steps.map((s) => s.limiter), [{ value: 3, range: 3 }, { value: 2, range: 5 }]);
  assert.equal(NSXCore.profileHasExecutionChanges(built, varied), false, "and it is not an edit");
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

/* ── Content-addressed saves: did the POST create anything? ──────────────────
 * POST /profiles hashes the execution fields, so a profile whose execution
 * already exists comes back as the STORED record with a 201. Verified against a
 * live gateway: re-posting a Decent profile with only the title changed returns
 * the untouched default. These two guards are what keep that from being
 * reported as a save.
 */

test("isProfileSaveDeduped: the record we forked away from coming back is not a save", () => {
  const deduped = { id: "profile:default", profile: { title: "A-Flow / default" } };
  assert.equal(
    NSXCore.isProfileSaveDeduped(deduped, { title: "My A-Flow", avoidId: "profile:default" }),
    true,
  );
});

test("isProfileSaveDeduped: an unrelated hash collision is caught by the title", () => {
  // A different id, but not the profile we sent — the gateway matched some
  // other stored record's execution hash.
  const other = { id: "profile:other", profile: { title: "Someone else's profile" } };
  assert.equal(NSXCore.isProfileSaveDeduped(other, { title: "My A-Flow", avoidId: "profile:default" }), true);
});

test("isProfileSaveDeduped: a genuinely new record passes", () => {
  const fresh = { id: "profile:new", profile: { title: "My A-Flow" } };
  assert.equal(NSXCore.isProfileSaveDeduped(fresh, { title: "My A-Flow", avoidId: "profile:default" }), false);
  assert.equal(NSXCore.isProfileSaveDeduped(fresh, { title: "My A-Flow" }), false, "no source to avoid");
});

test("isProfileSaveDeduped: no record at all is a failed save, not a silent success", () => {
  assert.equal(NSXCore.isProfileSaveDeduped(null, { title: "My A-Flow" }), true);
  assert.equal(NSXCore.isProfileSaveDeduped(undefined, { title: "My A-Flow" }), true);
});

test("isUnchangedProfileCopy: a rename-only copy would dedup, so it is refused up front", () => {
  const renamed = { ...ORIGINAL, title: "My A-Flow" };
  assert.equal(NSXCore.isUnchangedProfileCopy(renamed, ORIGINAL), true);
});

test("isUnchangedProfileCopy: an execution change is a real copy", () => {
  const changed = JSON.parse(JSON.stringify(ORIGINAL));
  changed.steps[0].temperature = 95;
  assert.equal(NSXCore.isUnchangedProfileCopy(changed, ORIGINAL), false);
});

test("isUnchangedProfileCopy: a brand-new profile has nothing to be a copy of", () => {
  assert.equal(NSXCore.isUnchangedProfileCopy(ORIGINAL, null), false);
});

/* ── Group temperature: resolved, never carried over ─────────────────────────
 * A DE1 profile states its temperature per STEP; `groupTemp` is this skin
 * family's own top-level field, so every bundled and imported profile arrives
 * without one. Both of these tests pin a bug that came from treating it as if
 * it were always present and always current.
 */

// A bundled profile as the gateway serves it: per-step temperatures, no groupTemp.
const BUNDLED = {
  title: "A-Flow / default",
  steps: [
    { name: "Pre Fill", pump: "flow", flow: 8, seconds: 1, temperature: 93, sensor: "coffee" },
    { name: "Extract", pump: "pressure", pressure: 9, seconds: 20, temperature: 93, sensor: "coffee" },
  ],
};
const draftOf = (profile) => ({
  title: profile.title, author: profile.author || "", notes: profile.notes || "",
  beverageType: profile.beverage_type || "espresso",
  // What the editor seeds: the resolved temperature, since there is no stored one.
  groupTemp: 93,
  frames: profile.steps.map(NSXCore.normalizeProfileFrame),
  limits: NSXCore.normalizeProfileLimits(profile, profile.steps),
});

test("a bundled profile saved untouched is NOT an execution change", () => {
  // Regression: the built profile carries a resolved groupTemp and the original
  // carries none, so comparing the field raw made every untouched save of a
  // Decent profile fork it — leaving a user copy with the same name beside it.
  const built = NSXCore.buildProfileFromDraft(draftOf(BUNDLED), BUNDLED);
  assert.equal(NSXCore.profileHasExecutionChanges(built, BUNDLED), false);
  assert.equal(NSXCore.isUnchangedProfileCopy(built, BUNDLED), true, "and so the copy is refused");
});

test("a frame's temperature is a deviation from groupTemp, not a redefinition of it", () => {
  // groupTemp is the profile's REFERENCE temperature — the DE1's own shot
  // settings carry one, and buildGatewayPayload shifts every frame by
  // (dialed - groupTemp) on push. NSX's editor moves all frames together when
  // the reference moves, and leaves the reference alone when one frame is
  // edited; a frame sitting above or below it is the point of a frame.
  // Deriving groupTemp from the first step instead would re-baseline every
  // profile whose frames vary — and every recipe pushing one.
  const draft = draftOf(BUNDLED);
  draft.frames[0].temperature = 95;
  const built = NSXCore.buildProfileFromDraft(draft, BUNDLED);
  assert.deepEqual(built.steps.map((s) => s.temperature), [95, 93]);
  assert.equal(built.groupTemp, 93, "the reference stays where the profile put it");
  assert.equal(NSXCore.profileHasExecutionChanges(built, BUNDLED), true, "the frame change is still a real change");
});

test("a profile whose reference differs from its first frame survives a resave", () => {
  // The case deriving groupTemp from step one would have broken: reference 93,
  // frames deliberately 90/96 around it.
  const varied = {
    title: "Varied",
    groupTemp: 93,
    steps: [
      { name: "a", pump: "flow", flow: 8, seconds: 1, temperature: 90, sensor: "coffee" },
      { name: "b", pump: "pressure", pressure: 9, seconds: 20, temperature: 96, sensor: "coffee" },
    ],
  };
  const draft = { ...draftOf(varied), groupTemp: 93 };
  const built = NSXCore.buildProfileFromDraft(draft, varied);
  assert.equal(built.groupTemp, 93);
  assert.equal(NSXCore.profileHasExecutionChanges(built, varied), false, "an untouched resave changes nothing");
});
