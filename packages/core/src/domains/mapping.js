"use strict";
/**
 * NSXCore mapping domain — pure shot/workflow data transformations.
 *
 * Unlike the other domains, this one owns no state at all: every function is
 * a pure transformation of its arguments, with no DOM and no app-state reads
 * (live app state like the current `shots` array or the rating cache is
 * passed in explicitly by the caller, same pattern as
 * buildGatewayPayload's opts.scaleConnected in workflow.js). A future skin
 * needs byte-identical shot normalization, workflow↔shot mapping, and
 * formatting — this is the shared "domain model" layer, as opposed to the
 * UI-rendering code that stays in each skin.
 *
 * Registered on NSXCore:
 *   formatMmSs(ms), calcRatio(dose, yield_), resolveProfileTemp(profile),
 *   mapApiWorkflowToDisplay(wf), mapShotToWorkflow(shot),
 *   normalizeWorkflowKeyPart(value), getWorkflowKey(workflow),
 *   normalizeShotData(shot), getShotDurationSeconds(fullShot),
 *   buildShotDiffData(currentShot, latestShot, currentDurationSec, latestDurationSec),
 *   buildWorkflowItemsFromShots(shotItems, ratingCache),
 *   findShotsForWorkflow(workflow, source),
 *   resolveActualDose(shot), resolveActualYield(fullShot),
 *   resolveShotVolumeAndWeight(fullShot), updateVolumeCalibration(existingCal, fullShot),
 *   getBatchAge(iso)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.mapping] core.js must load before domains/mapping.js");
    return;
  }

  function formatMmSs(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function calcRatio(dose, yield_) {
    return dose > 0 ? `1:${(yield_ / dose).toFixed(1)}` : "—";
  }

  // A shot's `annotations.enjoyment` is 0-100 in the real API, NOT 1-5 — NSX
  // renders it as five stars at 20 points each (see ui.js's _starRatingHtml).
  // A skin that treats it as a 1-5 value both renders garbage AND writes back a
  // rating other skins read as near-zero, so the conversion lives here rather
  // than being re-derived (or re-forgotten) per skin.
  const ENJOYMENT_PER_STAR = 20;
  const MAX_STARS = 5;

  /** 0-100 enjoyment -> a whole number of stars (0-5), clamped. */
  function enjoymentToStars(enjoyment) {
    const value = Number(enjoyment);
    if (!Number.isFinite(value)) return 0;
    const stars = Math.round(value / ENJOYMENT_PER_STAR);
    return Math.max(0, Math.min(MAX_STARS, stars));
  }

  /** Stars (0-5) -> the 0-100 enjoyment value the API actually stores. */
  function starsToEnjoyment(stars) {
    const value = Number(stars);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(MAX_STARS, Math.round(value))) * ENJOYMENT_PER_STAR;
  }

  function resolveProfileTemp(prof) {
    // groupTemp (set by editor), then first frame temp, then tank_temperature
    const g = Number(prof?.groupTemp);
    if (Number.isFinite(g) && g > 0) return g;
    const frames = prof?.steps ?? prof?.frames ?? [];
    if (Array.isArray(frames)) {
      for (const f of frames) {
        const t = Number(f?.temperature);
        if (Number.isFinite(t) && t > 0) return t;
      }
    }
    const tank = Number(prof?.tank_temperature);
    return (Number.isFinite(tank) && tank > 0) ? tank : null;
  }

  function mapApiWorkflowToDisplay(wf) {
    const ctx = wf?.context || {};
    const dose = ctx.targetDoseWeight || 0;
    const yield_ = ctx.targetYield || 0;
    const prof = wf?.profile || {};
    const resolvedTemp = resolveProfileTemp(prof);
    return {
      coffeeRoaster: ctx.coffeeRoaster || "—",
      coffeeName: ctx.coffeeName || "—",
      grinderModel: ctx.grinderModel || "—",
      grinderSetting: ctx.grinderSetting || "—",
      targetDoseWeight: dose,
      targetYield: yield_,
      ratio: calcRatio(dose, yield_),
      profileTitle: prof.title || wf?.name || "—",
      profileTemp: resolvedTemp != null ? `${resolvedTemp}°C` : "—",
      beverageType: String(prof.beverage_type || "") || "—",
      gatewayWorkflow: wf || null,
    };
  }

  function mapShotToWorkflow(shot) {
    const ctx = shot?.workflow?.context || {};
    const dose = ctx.targetDoseWeight || 0;
    const yield_ = ctx.targetYield || 0;
    const profileTitle =
      shot?.workflow?.profile?.title ||
      shot?.workflow?.profileTitle ||
      shot?.profileTitle ||
      shot?.workflow?.name ||
      "—";

    const shotProf = shot?.workflow?.profile || shot?.profile || {};
    const shotTemp = resolveProfileTemp(shotProf);
    return {
      coffeeRoaster: ctx.coffeeRoaster || "—",
      coffeeName: ctx.coffeeName || "—",
      grinderModel: ctx.grinderModel || "—",
      grinderSetting: ctx.grinderSetting || "—",
      targetDoseWeight: dose,
      targetYield: yield_,
      ratio: calcRatio(dose, yield_),
      profileTitle,
      profileTemp: shotTemp != null ? `${shotTemp}°C` : "—",
    };
  }

  function normalizeWorkflowKeyPart(value) {
    return String(value || "—").trim().toLocaleLowerCase("de-DE");
  }

  function getWorkflowKey(workflow) {
    return [
      normalizeWorkflowKeyPart(workflow?.coffeeRoaster),
      normalizeWorkflowKeyPart(workflow?.coffeeName),
      normalizeWorkflowKeyPart(workflow?.grinderModel),
      normalizeWorkflowKeyPart(workflow?.profileTitle),
    ].join("||");
  }

  function normalizeShotData(shot) {
    if (!shot) return null;

    const toFiniteNumber = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const normalizeTemperatureCelsius = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      // Some records store deci-degrees (e.g. 890 => 89.0 C), others store C directly.
      return n > 200 ? n / 10 : n;
    };

    const frames = (() => {
      const profile = shot?.workflow?.profile || shot?.profile || null;
      const list = profile?.steps ?? profile?.frames ?? [];
      return Array.isArray(list) ? list : [];
    })();

    const rebaseElapsedToZero = (values) => {
      if (!Array.isArray(values) || values.length === 0) return [];
      const numeric = values.map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      });
      const first = numeric.find((v) => v !== null);
      const base = first != null ? first : 0;
      return numeric.map((v) => {
        if (v === null) return 0;
        return Math.max(0, v - base);
      });
    };

    if (shot.elapsed?.length) {
      const elapsed = rebaseElapsedToZero(shot.elapsed);
      return {
        ...shot,
        elapsed,
        scaleRate:
          shot.scaleRate ||
          shot.weightFlow ||
          shot.weight_flow ||
          shot.weightflow ||
          Array.from({ length: elapsed.length }, () => 0),
      };
    }

    const measurements = shot.measurements;
    if (!Array.isArray(measurements) || measurements.length === 0) return null;

    const elapsed = [];
    const pressure = [];
    const targetPressure = [];
    const flow = [];
    const targetFlow = [];
    const temperature = [];
    const targetTemperature = [];
    const scaleRate = [];
    const substates = [];
    const rawProfileFrames = [];

    let shotStartTime = null;

    for (const m of measurements) {
      const machine = m.machine;
      if (!machine || !machine.state) continue;

      if (machine.state.substate !== "preinfusion" && machine.state.substate !== "pouring") {
        continue;
      }

      const timestamp = new Date(machine.timestamp).getTime();
      if (!Number.isFinite(timestamp)) continue;
      if (shotStartTime == null) shotStartTime = timestamp;
      const time = (timestamp - shotStartTime) / 1000;
      if (time < 0) continue;

      elapsed.push(time);
      pressure.push(machine.pressure || 0);
      targetPressure.push(machine.targetPressure || 0);
      flow.push(machine.flow || 0);
      targetFlow.push(machine.targetFlow || 0);
      temperature.push(normalizeTemperatureCelsius(machine.groupTemperature));
      targetTemperature.push(normalizeTemperatureCelsius(machine.targetGroupTemperature));
      substates.push(machine.state?.substate || "");

      const rawProfileFrame =
        machine.profileFrame ??
        machine.profile_frame ??
        machine.state?.profileFrame ??
        machine.state?.profile_frame;
      const profileFrame = Number(rawProfileFrame);
      rawProfileFrames.push(Number.isFinite(profileFrame) ? profileFrame : null);

      const rawWeightFlow =
        m.scale?.weightFlow ??
        m.scale?.weight_flow ??
        m.scale?.flow ??
        machine.weightFlow ??
        machine.weight_flow ??
        m.weightFlow ??
        m.weight_flow;

      scaleRate.push(toFiniteNumber(rawWeightFlow, 0));
    }

    const phaseMarkers = [];
    let lastProfileFrame = null;
    for (let i = 0; i < rawProfileFrames.length; i += 1) {
      const profileFrame = rawProfileFrames[i];
      if (!Number.isFinite(profileFrame)) continue;
      if (profileFrame === lastProfileFrame) continue;

      const frameDef = frames[profileFrame] ?? null;
      const frameLabel = String(frameDef?.name || `Step ${profileFrame + 1}`);
      phaseMarkers.push({
        time: Math.max(0, Number(elapsed[i]) || 0),
        label: frameLabel,
      });
      lastProfileFrame = profileFrame;
    }

    return {
      elapsed,
      pressure,
      targetPressure,
      flow,
      targetFlow,
      temperature,
      targetTemperature,
      scaleRate,
      substates,
      phaseMarkers,
    };
  }

  function getShotDurationSeconds(fullShot) {
    const normalized = normalizeShotData(fullShot);
    if (!normalized?.elapsed?.length) return null;
    const last = normalized.elapsed[normalized.elapsed.length - 1];
    return Number.isFinite(last) ? Math.max(0, last) : null;
  }

  /**
   * The last real scale-weight sample and the last machine-reported volume
   * sample from a FULL shot's measurements — the two raw ingredients the
   * virtual-scale calibration feedback loop needs. Falls back to the
   * machine's own volume snapshot if no per-sample volume was recorded.
   * Mirrors NSX's real post-shot calibration read exactly (app.js's
   * _runPostShotActions).
   */
  function resolveShotVolumeAndWeight(fullShot) {
    let volume = null;
    let weight = null;
    const measurements = fullShot?.measurements;
    if (Array.isArray(measurements)) {
      for (let i = measurements.length - 1; i >= 0; i--) {
        const w = measurements[i]?.scale?.weight ?? measurements[i]?.scale?.weight_grams ?? null;
        if (weight === null && Number.isFinite(w) && w > 0) weight = w;
        const v = measurements[i]?.machine?.volume ?? measurements[i]?.volume ?? null;
        if (volume === null && Number.isFinite(v) && v > 0) volume = v;
        if (weight !== null && volume !== null) break;
      }
    }
    if (volume === null) {
      const snapVol = Number(fullShot?.snapshot?.volume);
      if (Number.isFinite(snapVol) && snapVol > 0) volume = snapVol;
    }
    return { volume, weight };
  }

  const VOLUME_SAMPLE_MIN_VOLUME = 5;
  const VOLUME_SAMPLE_RATIO_MIN = 0.5;
  const VOLUME_SAMPLE_RATIO_MAX = 1.5;
  const VOLUME_SAMPLE_WINDOW = 4;

  /**
   * Learns (or refines) the ml-per-gram factor a recipe uses to estimate
   * weight from the machine's own volume tracking when no physical scale is
   * connected. Runs after EVERY shot, not just scale-less ones — it needs a
   * real scale-weight sample to learn from, so a shot brewed WITH a scale is
   * exactly what teaches the factor that later gets used WITHOUT one.
   * Rejects an implausible sample (too little volume, or a ratio outside
   * 0.5-1.5 ml/g) rather than letting one bad reading corrupt the average —
   * same bounds and 4-sample rolling window as NSX's real calibration.
   */
  function updateVolumeCalibration(existingCal, fullShot) {
    const cal = existingCal && typeof existingCal === "object" ? existingCal : { factor: 1.0, samples: [] };
    const { volume, weight } = resolveShotVolumeAndWeight(fullShot);
    if (!Number.isFinite(volume) || !Number.isFinite(weight) || weight <= 0) return cal;

    const sample = volume / weight;
    const valid = volume >= VOLUME_SAMPLE_MIN_VOLUME && sample >= VOLUME_SAMPLE_RATIO_MIN && sample <= VOLUME_SAMPLE_RATIO_MAX;
    if (!valid) return cal;

    const samples = [...(cal.samples || []), sample].slice(-VOLUME_SAMPLE_WINDOW);
    const factor = samples.reduce((a, b) => a + b, 0) / samples.length;
    return { factor, samples };
  }

  /**
   * The dose the ratio/review screen should show: an editable actualDoseWeight
   * annotation the user recorded for this specific shot, falling back to the
   * recipe's planned targetDoseWeight if nothing was recorded (the DE1/scale
   * never measures dose-in itself, only output — this is the same ceiling
   * NSX's shot review has always had, not a gap to fix further).
   */
  function resolveActualDose(shot) {
    const measuredDose = Number(shot?.annotations?.actualDoseWeight);
    if (Number.isFinite(measuredDose) && measuredDose > 0) return measuredDose;
    const target = Number(shot?.workflow?.context?.targetDoseWeight || 0);
    return target > 0 ? target : null;
  }

  /**
   * The actual measured output for a FULL shot record (must include
   * `measurements`/`snapshot` — the lightweight list-endpoint shot has
   * neither, so this always returns nulls for one of those; fetch via
   * NSXCore.getShotDetails(id) first). Resolution order mirrors NSX's shot
   * review exactly: a manually-entered actualYield annotation, then the
   * machine's own volume snapshot (ml, no scale needed), then the last
   * nonzero scale-weight sample, then a virtual-scale-estimated yield.
   */
  function resolveActualYield(fullShot) {
    const ann = fullShot?.annotations ?? {};
    const extras = ann.extras ?? {};
    // NSX marks a resolved yield "estimated" only when the virtualScale flag is
    // set, checked up front here rather than as a separate final-fallback
    // branch — nested the way NSX's own annotations shape it (extras.
    // actualYield), that branch never actually runs, since the top-level
    // fallback below already consumes extras.actualYield first.
    const isVirtualEstimate = extras.virtualScale === true;

    const annYield = Number(ann.actualYield ?? extras.actualYield);
    if (Number.isFinite(annYield) && annYield > 0) {
      return { value: annYield, unit: "g", estimated: isVirtualEstimate };
    }

    const snapVol = Number(fullShot?.snapshot?.volume);
    if (Number.isFinite(snapVol) && snapVol > 0) return { value: snapVol, unit: "ml", estimated: false };

    const measurements = fullShot?.measurements;
    if (Array.isArray(measurements)) {
      for (let i = measurements.length - 1; i >= 0; i--) {
        const w = measurements[i]?.scale?.weight ?? measurements[i]?.scale?.weight_grams ?? null;
        if (Number.isFinite(w) && w > 0) return { value: w, unit: "g", estimated: false };
      }
    }

    return { value: null, unit: "g", estimated: false };
  }

  // Why a persisted shot ended, as decided by the app's shot sequencer. This is
  // an OPEN SET: newer gateway/app builds may add values, so callers MUST
  // tolerate a string not in KNOWN_STOP_REASONS. Returns null for legacy shots
  // and shots the app didn't sequence (e.g. full gateway mode while
  // backgrounded). Aborted shots (no scale, or a stop before the pour began)
  // and mid-shot disconnects are NOT persisted at all — their reasons live only
  // on the /ws/v1/machine/shotState feed, which this does not read.
  const KNOWN_STOP_REASONS = ["targetWeight", "targetVolume", "apiStop", "appStop", "machineEnded", "error"];
  function getShotStopReason(shot) {
    const raw = shot?.stopReason;
    return typeof raw === "string" && raw ? raw : null;
  }
  function isKnownStopReason(reason) {
    return KNOWN_STOP_REASONS.includes(reason);
  }

  /**
   * Roast-date age, e.g. "2 weeks". A recipe's roast date lives on the batch, not
   * the bean (see the workflow domain) — this just formats a duration. Reads
   * window.NSXI18n?.t for the day/week/month/year unit, same optional-chaining
   * pattern as buildShotDiffData below: translations.js is always loaded (core
   * bootstrap order), but a skin without it still gets an English fallback rather
   * than a crash.
   */
  function getBatchAge(iso) {
    const t = window.NSXI18n?.t || ((k) => k.split(".").pop());
    if (!iso) return "—";
    const roastDate = new Date(iso);
    if (Number.isNaN(roastDate.getTime())) return "—";

    const diffMs = Date.now() - roastDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "—";

    if (diffDays < 7) return `${diffDays} ${t(diffDays === 1 ? "time.day" : "time.days")}`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} ${t(weeks === 1 ? "time.week" : "time.weeks")}`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} ${t(months === 1 ? "time.month" : "time.months")}`;
    }
    const years = Math.floor(diffDays / 365);
    return `${years} ${t(years === 1 ? "time.year" : "time.years")}`;
  }

  function buildShotDiffData(currentShot, latestShot, currentDurationSec, latestDurationSec) {
    const t = window.NSXI18n?.t || ((k) => k);
    const current = mapShotToWorkflow(currentShot);
    const latest = mapShotToWorkflow(latestShot);

    const rows = [];
    const toNumberOrNull = (value) => {
      const n = Number(String(value ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const formatSigned = (value, decimals = 1, unit = "") => {
      if (!Number.isFinite(value)) return "--";
      const sign = value > 0 ? "+" : "";
      return `${sign}${value.toFixed(decimals)}${unit}`;
    };

    const currentGrind = String(current.grinderSetting ?? "—").trim();
    const latestGrind = String(latest.grinderSetting ?? "—").trim();
    if (currentGrind !== latestGrind) {
      const currentGrindNum = toNumberOrNull(current.grinderSetting);
      const latestGrindNum = toNumberOrNull(latest.grinderSetting);
      const grindDelta =
        currentGrindNum !== null && latestGrindNum !== null
          ? ` (${formatSigned(currentGrindNum - latestGrindNum, 2)})`
          : "";
      rows.push({ label: t("recipe.grindSize"), value: `${current.grinderSetting || "—"}${grindDelta}` });
    }

    const currentDose = Number(current.targetDoseWeight || 0);
    const latestDose = Number(latest.targetDoseWeight || 0);
    if (Math.abs(currentDose - latestDose) > 0.0001) {
      const doseDelta = formatSigned(currentDose - latestDose, 1, "g");
      rows.push({ label: t("recipeEdit.dose"), value: `${currentDose.toFixed(1)}g (${doseDelta})` });
    }

    const currentYield = Number(current.targetYield || 0);
    const latestYield = Number(latest.targetYield || 0);
    const currentRatio = current.ratio || "—";
    const latestRatio = latest.ratio || "—";
    if (Math.abs(currentYield - latestYield) > 0.0001 || currentRatio !== latestRatio) {
      const yieldDelta = formatSigned(currentYield - latestYield, 1, "g");
      const currentRatioNum = currentDose > 0 ? currentYield / currentDose : null;
      const latestRatioNum = latestDose > 0 ? latestYield / latestDose : null;
      const ratioDelta =
        currentRatioNum !== null && latestRatioNum !== null
          ? formatSigned(currentRatioNum - latestRatioNum, 2)
          : "--";
      rows.push({
        label: t("recipe.beverage"),
        value: `${currentYield.toFixed(1)}g (${currentRatio}) (${yieldDelta}, ${ratioDelta})`,
      });
    }

    const hasCurrentDuration = Number.isFinite(currentDurationSec);
    const hasLatestDuration = Number.isFinite(latestDurationSec);
    if (hasCurrentDuration && (!hasLatestDuration || Math.abs(currentDurationSec - latestDurationSec) > 0.049)) {
      const durationDelta = hasLatestDuration
        ? formatSigned(currentDurationSec - latestDurationSec, 1, "s")
        : "--";
      rows.push({ label: t("recipe.duration"), value: `${currentDurationSec.toFixed(1)}s (${durationDelta})` });
    }

    return rows;
  }

  // ratingCache: optional Map<workflowKey, {max, count}> — the caller's
  // (app.js) authoritative per-recipe rating cache, consulted so recipe cards
  // show fetched ratings instead of the shot-list approximation once loaded.
  function buildWorkflowItemsFromShots(shotItems, ratingCache) {
    const grouped = new Map();

    for (const shot of shotItems) {
      const mapped = mapShotToWorkflow(shot);
      const key = getWorkflowKey(mapped);

      const timestamp = shot?.timestamp ? Date.parse(shot.timestamp) : 0;
      const latestTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
      const existing = grouped.get(key);

      const rv = Number(shot?.annotations?.enjoyment ?? shot?.metadata?.rating);
      const prevMax = existing?.ratingMax ?? null;
      const prevCount = existing?.ratingCount ?? 0;
      // ratingCount = how many shots share the maximum rating (not total rated shots)
      let ratingMax = prevMax;
      let ratingCount = prevCount;
      if (Number.isFinite(rv)) {
        if (prevMax === null || rv > prevMax) { ratingMax = rv; ratingCount = 1; }
        else if (rv === prevMax) { ratingCount = prevCount + 1; }
      }

      if (!existing || latestTimestamp >= existing.latestTimestamp) {
        grouped.set(key, {
          ...mapped,
          latestTimestamp,
          gatewayWorkflow: shot?.workflow || null,
          ratingMax,
          ratingCount,
        });
      } else {
        existing.ratingMax = ratingMax;
        existing.ratingCount = ratingCount;
      }
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
      .map(({ latestTimestamp, ratingMax, ratingCount, ...item }) => {
        const cached = ratingCache?.get(getWorkflowKey(item));
        item.maxRating = cached ? cached.max : (ratingMax ?? null);
        item.ratedCount = cached ? cached.count : (ratingCount || 0);
        return item;
      });
  }

  // Max enjoyment rating across a shot list, plus how many shots share that
  // maximum (NOT the total number of rated shots). Returns {max, count}.
  function computeMaxRating(shotList) {
    let max = null, count = 0;
    for (const s of shotList || []) {
      const r = Number(s?.annotations?.enjoyment ?? s?.metadata?.rating);
      if (!Number.isFinite(r)) continue;
      if (max === null || r > max) { max = r; count = 1; }
      else if (r === max) { count++; }
    }
    return { max, count };
  }

  // source: the shot list to search (caller's live `shots` or a history
  // source array) — passed explicitly since this domain owns no shot state.
  function findShotsForWorkflow(workflow, source) {
    if (!workflow || !Array.isArray(source) || source.length === 0) {
      return [];
    }

    const key = getWorkflowKey(workflow);

    return source
      .filter((shot) => getWorkflowKey(mapShotToWorkflow(shot)) === key)
      .sort((a, b) => {
        const tsA = Date.parse(a?.timestamp || 0);
        const tsB = Date.parse(b?.timestamp || 0);
        return (Number.isFinite(tsB) ? tsB : 0) - (Number.isFinite(tsA) ? tsA : 0);
      });
  }

  // When each workflow key was last brewed: key -> newest shot timestamp (ms).
  // Built once per sort instead of scanning the shot list per recipe.
  function buildLastUsedIndex(shots) {
    const index = new Map();
    for (const shot of shots || []) {
      const ts = Date.parse(shot?.timestamp || 0);
      if (!Number.isFinite(ts)) continue;
      const key = getWorkflowKey(mapShotToWorkflow(shot));
      if (!index.has(key) || ts > index.get(key)) index.set(key, ts);
    }
    return index;
  }

  // Most recently brewed recipe first. A recipe that was never brewed has no
  // shot to date it, so it keeps its original relative order at the end of the
  // list rather than being dated 0 and interleaved with genuinely old ones.
  function sortRecipesByLastUsed(recipes, shots) {
    const index = buildLastUsedIndex(shots);
    const list = (recipes || []).map((recipe, i) => ({ recipe, i, at: index.get(getWorkflowKey(recipe)) ?? null }));
    list.sort((a, b) => {
      if (a.at === b.at) return a.i - b.i;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return b.at - a.at;
    });
    return list.map((entry) => entry.recipe);
  }

  NSXCore.register({
    buildLastUsedIndex,
    sortRecipesByLastUsed,
    formatMmSs,
    calcRatio,
    enjoymentToStars,
    starsToEnjoyment,
    resolveProfileTemp,
    mapApiWorkflowToDisplay,
    mapShotToWorkflow,
    normalizeWorkflowKeyPart,
    getWorkflowKey,
    normalizeShotData,
    getShotDurationSeconds,
    buildShotDiffData,
    buildWorkflowItemsFromShots,
    computeMaxRating,
    findShotsForWorkflow,
    resolveActualDose,
    resolveActualYield,
    resolveShotVolumeAndWeight,
    getShotStopReason,
    isKnownStopReason,
    updateVolumeCalibration,
    getBatchAge,
  });
})();
