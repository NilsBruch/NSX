"use strict";
/**
 * NSXCore profile-edit domain — pure normalize/build logic for a profile
 * editor. Owns no state (same category as mapping.js/profile-render.js):
 * every call is a pure function of its arguments.
 *
 * Ported from NSX's profile editor (packages/nsx/src/modules/app.js,
 * `_peditor*` functions) but deliberately NOT byte-for-byte: that
 * implementation has a live bug (an undefined variable in its save path), a
 * dead alternate layout, and a dirty-tracking snapshot that omits fields it
 * actually persists (tank temp, limiter ranges) — see the profile-editor
 * plan for the full list. This module keeps the correct behavior only.
 *
 * ── Two levels of shape ──────────────────────────────────────────────────
 * A raw DE1 profile step has an awkward dual exit representation (a nested
 * `exit: {type,condition,value}` object, OR flattened `exit_if`/`exit_type`/
 * `exit_pressure_over` etc. — real profiles use either). normalizeProfileFrame
 * collapses that into one flat, UI-friendly frame shape. buildProfileFromDraft
 * is the inverse: it re-serializes that shape back into a real DE1 profile,
 * always writing the canonical NESTED exit object (never the flattened one).
 *
 * Limiter RANGE (the PID transition softness) is genuinely profile-global in
 * the stock DE1 app's own Limits page — one flow-range and one pressure-range
 * slider for the whole profile, not per step. Only the limiter VALUE (the
 * absolute cap) is per-frame. That split is intentional, not a simplification.
 *
 * Registered on NSXCore:
 *   normalizeProfileFrame(raw) -> editor frame
 *   normalizeFrameExit(frame) -> { enabled, type, value }
 *   frameExitToObject(type, value) -> nested { type, condition, value }
 *   normalizeProfileLimits(profile) -> Limits-tab state object
 *   hasDivergentLimiterRanges(frames, pumpMode) -> bool
 *   buildProfileFromDraft(draft, originalProfile) -> profile JSON
 *   makeDefaultFrame(lastFrame) -> a new editor frame seeded from the last one
 *   isUserOwnedProfile(record) -> bool
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.profile-edit] core.js must load before domains/profile-edit.js");
    return;
  }

  function extractFrames(profile) {
    const frames = profile?.steps ?? profile?.frames ?? [];
    return Array.isArray(frames) ? frames : [];
  }

  function isUserOwnedProfile(record) {
    if (record?.isDefault) return false;
    const src = String(record?.metadata?.source || "").trim().toLowerCase();
    return !src || src === "user";
  }

  // ── Exit condition ──────────────────────────────────────────────────────
  // Canonical flattened enum used by the editor's 4-way selector AND by any
  // read-only display: 'pressure_over' | 'pressure_under' | 'flow_over' |
  // 'flow_under' | 'weight'. `weight` has no selector in any UI (stock app
  // or NSX) but round-trips fine through this same shape if it's ever present
  // on an imported profile.
  function exitValueFromFlattened(type, frame) {
    switch (String(type || "").toLowerCase()) {
      case "pressure_under": return Math.max(0, Number(frame?.exit_pressure_under) || 0);
      case "flow_over": return Math.max(0, Number(frame?.exit_flow_over) || 0);
      case "flow_under": return Math.max(0, Number(frame?.exit_flow_under) || 0);
      case "weight": return Math.max(0, Number(frame?.exit_weight) || 0);
      default: return Math.max(0, Number(frame?.exit_pressure_over) || 0);
    }
  }

  // raw frame -> { enabled, type, value }. The nested `exit` object is
  // authoritative for type/value whenever present; `exit_if` (if present) is
  // authoritative for enabled-ness; flattened exit_* fields are the fallback
  // for profiles that carry no nested object at all.
  function normalizeFrameExit(frame) {
    const direct = frame?.exit;
    if (direct && typeof direct === "object") {
      const t = String(direct.type || "").toLowerCase();
      const c = String(direct.condition || "").toLowerCase();
      const value = Math.max(0, Number(direct.value) || 0);
      const type = t === "weight" ? "weight" : t === "flow" ? (c === "under" ? "flow_under" : "flow_over") : (c === "under" ? "pressure_under" : "pressure_over");
      const enabled = frame?.exit_if != null ? Boolean(frame.exit_if) : true;
      return { enabled, type, value };
    }
    const type = String(frame?.exit_type || "pressure_over").toLowerCase();
    return { enabled: Boolean(frame?.exit_if), type, value: exitValueFromFlattened(type, frame) };
  }

  // (type, value) -> the canonical nested object written back to the profile.
  function frameExitToObject(type, value) {
    const v = Math.max(0, Number(value) || 0);
    switch (type) {
      case "pressure_under": return { type: "pressure", condition: "under", value: v };
      case "flow_over": return { type: "flow", condition: "over", value: v };
      case "flow_under": return { type: "flow", condition: "under", value: v };
      case "weight": return { type: "weight", condition: "over", value: v };
      default: return { type: "pressure", condition: "over", value: v }; // pressure_over
    }
  }

  // ── Frame (step) normalize ───────────────────────────────────────────────
  // raw DE1 step -> flat editor frame. Profile-level fields some profiles
  // wrongly nest inside a step (tank_temperature, target_weight,
  // target_volume, target_volume_count_start) are stripped out here so they
  // never leak into `_rest` and get exported back onto an individual frame.
  function normalizeProfileFrame(raw) {
    const {
      name, pump, flow, pressure, seconds, temperature, transition, sensor, limiter, volume, weight,
      exit, exit_if, exit_type, exit_pressure_over, exit_pressure_under, exit_flow_over, exit_flow_under, exit_weight,
      tank_temperature, target_volume, target_volume_count_start, target_weight,
      ...rest
    } = raw || {};

    const exitInfo = normalizeFrameExit(raw);

    return {
      name: String(name || ""),
      pump: pump === "flow" ? "flow" : "pressure",
      flow: Math.max(0, Number(flow) || 0),
      pressure: Math.max(0, Number(pressure) || 0),
      seconds: Math.max(0, Number(seconds) || 0),
      temperature: Number(temperature) > 0 ? Number(temperature) : 93.0,
      transition: transition === "smooth" ? "smooth" : "fast",
      sensor: sensor === "water" ? "water" : "coffee",
      limiterEnabled: limiter && typeof limiter === "object" ? Number(limiter.value) > 0 : false,
      limiterValue: limiter && typeof limiter === "object" && Number(limiter.value) > 0 ? Number(limiter.value) : 0,
      // 0 IS "off" for these (see the *Enabled flags right here, and
      // frameToStep, which writes 0 for a disabled one). Seeding an unset
      // field with a plausible-looking number instead made every step of
      // every profile read as if it carried a 36 g / 36 ml cap it does not
      // have — an editor must show what the profile says, never a default.
      volumeEnabled: Number(volume) > 0,
      volumeValue: Number(volume) > 0 ? Number(volume) : 0,
      weightEnabled: Number(weight) > 0,
      weightValue: Number(weight) > 0 ? Number(weight) : 0,
      exitEnabled: exitInfo.enabled,
      exitType: exitInfo.type,
      exitValue: exitInfo.value,
      _rest: rest,
    };
  }

  // A sane new frame for the "Add step" button, seeded from whichever frame
  // precedes it (or defaults, for the very first frame in a profile).
  function makeDefaultFrame(lastFrame) {
    return {
      name: "",
      pump: lastFrame?.pump ?? "pressure",
      flow: lastFrame?.flow ?? 2.0,
      pressure: lastFrame?.pressure ?? 6.0,
      seconds: 10,
      temperature: lastFrame?.temperature ?? 93.0,
      transition: lastFrame?.transition ?? "fast",
      sensor: lastFrame?.sensor ?? "coffee",
      limiterEnabled: false,
      limiterValue: 0,
      volumeEnabled: false,
      volumeValue: 0,
      weightEnabled: false,
      weightValue: 0,
      exitEnabled: false,
      exitType: "pressure_over",
      exitValue: 0,
      _rest: {},
    };
  }

  // ── Profile-level "Limits" (stock app's Limits tab) ─────────────────────
  // limiter_flow_range/limiter_pressure_range are profile-level fields in the
  // stock app's OWN editing model, but a real (imported, or pre-dating this
  // model) profile may carry no such top-level field at all — only per-frame
  // limiter.range values. Falling straight back to a generic 0.6 in that case
  // would silently overwrite every frame's actual range the first time
  // someone opens the editor and saves without touching Limits at all.
  // Scanning the frames for an existing range keeps that round-trip lossless.
  function rangeFromFrames(frames, pumpMode) {
    for (const f of frames) {
      const mode = f?.pump === "flow" ? "flow" : "pressure";
      if (mode === pumpMode && f?.limiter && typeof f.limiter === "object" && Number(f.limiter.range) > 0) {
        return Number(f.limiter.range);
      }
    }
    return null;
  }
  /**
   * True when this profile's ACTIVE (value > 0) limiter steps of the given
   * pump mode carry more than one distinct non-zero range. The editor keeps
   * exactly one range per pump mode (see the file header) — matching every
   * profile actually observed in the wild, including Decent's own bundled
   * ones and third-party profiles (an audit of 90 real profiles found zero
   * with genuine per-step divergence). This exists so a profile that DOES
   * diverge can be flagged instead of silently collapsed to whichever range
   * rangeFromFrames happens to see first.
   */
  function hasDivergentLimiterRanges(frames, pumpMode) {
    const ranges = new Set();
    for (const f of frames || []) {
      const mode = f?.pump === "flow" ? "flow" : "pressure";
      if (mode !== pumpMode) continue;
      if (f?.limiter && typeof f.limiter === "object" && Number(f.limiter.value) > 0 && Number(f.limiter.range) > 0) {
        ranges.add(Number(f.limiter.range));
      }
    }
    return ranges.size > 1;
  }

  function normalizeProfileLimits(profile, frames) {
    const rawFrames = Array.isArray(frames) ? frames : extractFrames(profile);
    const tank = Number(profile?.tank_temperature);
    const weight = Number(profile?.target_weight);
    const volume = Number(profile?.target_volume);
    const volumeStart = Number(profile?.target_volume_count_start);
    const flowRange = Number(profile?.limiter_flow_range);
    const pressureRange = Number(profile?.limiter_pressure_range);
    return {
      tankTempEnabled: tank > 0,
      tankTempValue: tank > 0 ? tank : 0,
      stopWeightEnabled: weight > 0,
      stopWeightValue: weight > 0 ? weight : 0, // 0 = off, same as stopVolumeValue below
      stopVolumeEnabled: volume > 0,
      stopVolumeValue: volume > 0 ? volume : 0,
      stopVolumeStartIndex: Number.isFinite(volumeStart) && volumeStart >= 0 ? volumeStart : 0,
      // A pressure-goal frame's limiter caps FLOW, so its range is the "flow range".
      limiterFlowRange: Number.isFinite(flowRange) && flowRange > 0 ? flowRange : (rangeFromFrames(rawFrames, "pressure") ?? 0.6),
      limiterPressureRange: Number.isFinite(pressureRange) && pressureRange > 0 ? pressureRange : (rangeFromFrames(rawFrames, "flow") ?? 0.6),
    };
  }

  // ── Serialize back to a real DE1 profile ────────────────────────────────
  // frame + its previous on-disk shape -> a DE1 step. Key-shape preservation:
  // flow/pressure are included if the original step had that key, OR the
  // frame's own pump mode needs it (a fresh/duplicated frame has no original
  // to match, so its pump mode alone decides).
  function frameToStep(frame, originalStep, limits) {
    const step = { ...(frame._rest || {}) };
    step.name = frame.name;
    step.pump = frame.pump;
    step.seconds = frame.seconds;
    step.temperature = frame.temperature;
    step.transition = frame.transition;
    step.sensor = frame.sensor;

    const hadFlow = Boolean(originalStep && "flow" in originalStep);
    const hadPressure = Boolean(originalStep && "pressure" in originalStep);
    if (hadFlow || frame.pump === "flow") step.flow = frame.flow;
    if (hadPressure || frame.pump === "pressure") step.pressure = frame.pressure;

    if (frame.limiterEnabled) {
      // The DE1 limits the OPPOSITE axis from the pump mode: a pressure-goal
      // frame's limiter caps flow, and vice versa.
      const range = frame.pump === "flow" ? limits.limiterPressureRange : limits.limiterFlowRange;
      step.limiter = { value: frame.limiterValue, range };
    } else if (originalStep && "limiter" in originalStep) {
      step.limiter = originalStep.limiter;
    } else {
      step.limiter = null;
    }

    step.volume = frame.volumeEnabled ? frame.volumeValue : 0;
    step.weight = frame.weightEnabled ? frame.weightValue : 0;
    step.exit = frame.exitEnabled ? frameExitToObject(frame.exitType, frame.exitValue) : null;
    return step;
  }

  /**
   * draft: {
   *   title, author, notes, groupTemp, beverageType,
   *   frames: [editorFrame, ...],
   *   limits: { tankTempEnabled, tankTempValue, stopWeightEnabled, stopWeightValue,
   *             stopVolumeEnabled, stopVolumeValue, stopVolumeStartIndex,
   *             limiterFlowRange, limiterPressureRange },
   * }
   * originalProfile: the raw profile this draft started from (or null, for a
   * brand-new profile) — supplies the base for unmodeled fields (beverage_type,
   * version, lang, …) and each step's flow/pressure/limiter key-shape.
   *
   * Version is bumped on every save (matches the stock app: an edited profile
   * is always a new version, even for a metadata-only change).
   */
  function buildProfileFromDraft(draft, originalProfile) {
    const orig = originalProfile || {};
    const origFrames = extractFrames(orig);
    // Whichever key the original used; brand-new profiles default to `steps`.
    const stepsKey = Array.isArray(orig.frames) && !Array.isArray(orig.steps) ? "frames" : "steps";
    const otherKey = stepsKey === "steps" ? "frames" : "steps";

    const steps = draft.frames.map((f, i) => frameToStep(f, origFrames[i], draft.limits));

    const profile = { ...orig };
    delete profile[otherKey];
    profile[stepsKey] = steps;
    profile.title = draft.title;
    profile.author = draft.author;
    profile.notes = draft.notes;
    profile.groupTemp = draft.groupTemp;
    profile.beverage_type = String(draft.beverageType || orig.beverage_type || "espresso");
    profile.tank_temperature = draft.limits.tankTempEnabled ? draft.limits.tankTempValue : 0;
    profile.target_weight = draft.limits.stopWeightEnabled ? draft.limits.stopWeightValue : 0;
    profile.target_volume = draft.limits.stopVolumeEnabled ? draft.limits.stopVolumeValue : 0;
    profile.target_volume_count_start = draft.limits.stopVolumeStartIndex;
    profile.limiter_flow_range = draft.limits.limiterFlowRange;
    profile.limiter_pressure_range = draft.limits.limiterPressureRange;
    profile.version = String((Number(orig.version) || 1) + 1);
    return profile;
  }

  // The metadata-vs-execution split a library save needs: does this edit
  // change what the DE1 actually brews (frames, temp, any stop/limit target),
  // or only descriptive fields (title/author/notes)? The bridge derives
  // profile ids from step content, so an execution change needs a new id
  // (POST + soft-delete-old); a metadata-only change can PUT in place.
  //
  // Compares CANONICALIZED shapes (normalizeProfileFrame / normalizeProfileLimits
  // on both sides), not raw JSON — a resave always renormalizes incidental
  // representation details (an omitted `limiter` key becomes an explicit
  // `null`, a profile-global range absent on the original becomes an explicit
  // top-level field once resolved, etc.), and none of that is a REAL change.
  function execSnapshot(profile) {
    return JSON.stringify({
      frames: extractFrames(profile).map(normalizeProfileFrame),
      groupTemp: Number(profile?.groupTemp) || 0,
      limits: normalizeProfileLimits(profile),
    });
  }
  function profileHasExecutionChanges(builtProfile, originalProfile) {
    return execSnapshot(builtProfile) !== execSnapshot(originalProfile);
  }

  NSXCore.register({
    normalizeProfileFrame,
    normalizeFrameExit,
    frameExitToObject,
    normalizeProfileLimits,
    hasDivergentLimiterRanges,
    buildProfileFromDraft,
    makeDefaultFrame,
    isUserOwnedProfile,
    profileHasExecutionChanges,
  });
})();
