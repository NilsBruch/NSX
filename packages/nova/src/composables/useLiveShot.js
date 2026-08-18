/**
 * Live shot + the recipe's history screen — one state machine, since "after the
 * shot, you're in the history screen for this recipe" is the whole point (see
 * the design log). Espresso only; steam/hotwater get their own simpler live
 * progress view in the next phase, not this graph.
 *
 * Mounted once as a global overlay (App.vue) since a hardware-triggered shot can
 * start while the user is on any tab, not just Espresso.
 */
import { reactive, ref, watch } from 'vue';
import { machine, shots, loadShots, currentWorkflow } from './useCore.js';
import { recipe, bumpRecipeLastUsed, saveVolumeCalibration } from './useRecipe.js';
import { skinSettings } from './useSettings.js';
import { flushSession } from './useCleaningSession.js';

const { NSXCore, NSXApi } = window;

export const phase = ref('hidden'); // 'hidden' | 'live' | 'saving' | 'history'
export const series = reactive({ elapsed: [], pressure: [], targetPressure: [], flow: [], targetFlow: [], temperature: [], weightFlow: [] });

// ── No-scale virtual weight (live volume-stop estimate) ──────────────────────
// With no scale AND a volume stop (stopAtWeight on, scale absent -> the machine
// stops on target_volume, see buildGatewayPayload), the DE1 is tracking VOLUME,
// not weight — but the live snapshot stream carries neither weight nor volume.
// So from the profile frame where the machine STARTS counting volume
// (target_volume_count_start), we integrate the snapshot flow ourselves and
// show it as an estimated weight (∫flow dt / calibration factor) — and paint
// the weight-flow series brown from the machine's own flow (flow / factor), so
// the graph visibly says "the machine thinks coffee is pouring". Estimate, not
// measurement: this mirrors the post-shot yield estimate exactly (volume /
// factor — see applyPostShotVirtualScale), which is why it divides by factor.
export const virtualScaleActive = ref(false); // true = weight readouts below are the estimate, not a real scale
export const liveVirtualWeight = ref(0);       // g, running estimate while counting
// The profile frame the machine is currently running (null when unknown) —
// skipStep's guard uses it to tell "the machine has moved on" from "my tap
// hasn't landed yet".
export const liveFrame = ref(null);
let _liveVolume = 0;   // ml integrated from live flow since counting started
let _volCounting = false;
let _lastSnapMs = 0;
// The live graph plots only the actual extraction (preinfusion + pouring), not
// the heating/preparing lead-in or the drip after the pour — so the clock is
// rebased to the FIRST extraction sample, not the espresso-state transition.
let _captureStarted = false;
function _volumeCountStart() {
  // Prefer the profile actually pushed to the gateway; fall back to the recipe's copy.
  const p = currentWorkflow.value?.profile ?? recipe.profile;
  return Number(p?.target_volume_count_start) || 0;
}
export const historyShots = ref([]); // this recipe's shots, newest first
export const historyIndex = ref(0);

/**
 * The FULL record (with `measurements`/`snapshot`) for the shot currently
 * shown in history — `historyShots` only holds the lightweight list-endpoint
 * shots (no measurements), so duration/ratio/actual-yield all read null off
 * them. NSX always re-fetches the full detail before computing shot-review
 * stats; this mirrors that instead of computing from the list item.
 */
export const currentFullShot = ref(null);

watch(
  [historyIndex, historyShots],
  async () => {
    const shot = historyShots.value[historyIndex.value];
    currentFullShot.value = null;
    if (!shot) return;
    try {
      currentFullShot.value = await NSXCore.getShotDetails(shot.id);
    } catch (err) {
      console.warn('[Nova] could not fetch full shot detail', err?.message);
    }
  },
  { immediate: true }
);

/** Records a corrected dose-in for the shot currently in review — the DE1
 *  never measures dose itself, so this is the same editable annotation NSX's
 *  shot review lets the user set (falls back to the recipe's target dose
 *  until edited). Refetches the full detail since updateShot invalidates it. */
export async function setActualDose(doseWeight) {
  cancelReviewAutoClose();
  const shot = historyShots.value[historyIndex.value];
  if (!shot) return;
  await NSXCore.updateShot(shot.id, { annotations: { actualDoseWeight: doseWeight } });
  currentFullShot.value = await NSXCore.getShotDetails(shot.id);
}

/** Wall-clock shot start — exported so the live strip chart can scroll its
 *  viewport at constant real-time speed between samples (see LiveStripChart). */
export const shotStartMs = ref(0);

watch(
  () => machine.state,
  (state, prev) => {
    // A forward-flush cleaning cycle also runs in `espresso` state, but it is
    // driven by CleaningAssistant.vue's own run screen, not this graph/review
    // pipeline (flushSession.active is set by loadForwardFlush and cleared
    // once the wizard closes — see useCleaningSession.js).
    if (flushSession.active) return;
    if (state === 'espresso' && prev !== 'espresso') startLive();
    else if (prev === 'espresso' && state !== 'espresso' && phase.value === 'live') finishLive();
  }
);

function startLive() {
  phase.value = 'live';
  shotStartMs.value = Date.now();
  series.elapsed = [];
  series.pressure = [];
  series.targetPressure = [];
  series.flow = [];
  series.targetFlow = [];
  series.temperature = [];
  series.weightFlow = [];
  // Arm the virtual scale for exactly the case the machine is volume-stopping:
  // a volume stop is only in effect when there's no scale AND stopAtWeight is on.
  virtualScaleActive.value = !machine.scaleConnected && !!recipe.stopAtWeight;
  liveVirtualWeight.value = 0;
  _liveVolume = 0;
  _volCounting = false;
  _lastSnapMs = 0;
  _captureStarted = false;
}

// liveShot updates arrive at the gateway's broadcast rate (~250ms) — sample on
// every gateway EVENT, not via a watch on the values: two identical consecutive
// snapshots (flow pinned at 0 during preinfusion soak) never fire a value-watch,
// and a missing sample is a visibly missing bar in the strip chart's flow bins.
NSXCore.on('liveShot', (snap) => {
  // Which profile frame the machine is executing. Read before the substate
  // filter below, since skipStep's guard needs it during preparing/heating too
  // — not only across the pouring window the graph captures.
  const f = Number(snap?.profileFrame);
  liveFrame.value = Number.isFinite(f) ? f : null;

  if (phase.value !== 'live') return;
  // Only capture the extraction itself — preinfusion + pouring — so the graph
  // doesn't run through the heating/preparing lead-in or the post-pour drip.
  // Same two substates the persisted review graph keeps (core normalizeShotData),
  // so live and review look identical. machine.substate is fed by the separate
  // machineState stream (useCore.js).
  const ss = machine.substate;
  if (ss !== 'preinfusion' && ss !== 'pouring') return;
  if (!_captureStarted) { _captureStarted = true; shotStartMs.value = Date.now(); }
  series.elapsed.push((Date.now() - shotStartMs.value) / 1000);
  series.pressure.push(snap?.pressure ?? 0);
  series.targetPressure.push(snap?.targetPressure ?? 0);
  series.flow.push(snap?.flow ?? 0);
  series.targetFlow.push(snap?.targetFlow ?? 0);
  series.temperature.push(snap?.groupTemperature ?? 0);

  // Weight-flow bars: the real scale's weight-flow, or — with no scale + volume
  // stop — the machine's OWN flow re-cast as an estimated g/s (still brown), but
  // only once volume counting has started (frame >= target_volume_count_start),
  // matching when the machine itself begins integrating toward its volume stop.
  let wflow = machine.weightFlow ?? 0;
  if (virtualScaleActive.value) {
    const factor = recipe.volumeCalibration?.factor || 1;
    const frame = Number(snap?.profileFrame);
    if (Number.isFinite(frame) && frame >= _volumeCountStart()) {
      const now = Date.now();
      if (!_volCounting) { _volCounting = true; _lastSnapMs = now; }
      const dt = (now - _lastSnapMs) / 1000;
      if (dt > 0 && dt < 2) _liveVolume += (snap?.flow ?? 0) * dt; // guard against gaps/pauses
      _lastSnapMs = now;
      liveVirtualWeight.value = factor > 0 ? _liveVolume / factor : 0;
      wflow = factor > 0 ? (snap?.flow ?? 0) / factor : 0;         // brown "coffee out" estimate
    } else {
      wflow = 0;                                                   // pre-count frames: nothing out yet
    }
  }
  series.weightFlow.push(wflow);
});

// ── Post-shot review auto-close ──────────────────────────────────────────────
// After a shot, the review lands open; it closes itself after the configured
// delay so the user doesn't have to. ONLY the post-shot review auto-closes —
// opening history manually (Espresso's History button, a Diary drill-down)
// never does. Any interaction (rate, edit dose, navigate) cancels it.
let _autoCloseTimer = null;
export function cancelReviewAutoClose() {
  if (_autoCloseTimer) { clearTimeout(_autoCloseTimer); _autoCloseTimer = null; }
}
function scheduleReviewAutoClose() {
  cancelReviewAutoClose();
  const sec = Number(skinSettings.shotReviewAutoCloseSec);
  if (!(sec > 0)) return; // 0 / off = stay open
  _autoCloseTimer = setTimeout(() => {
    if (phase.value === 'history') closeHistory();
  }, sec * 1000);
}

async function finishLive() {
  // A brief "Saving shot…" spinner instead of jumping straight to the history
  // screen — the gateway can lag a moment before a just-finished shot is
  // actually queryable, and landing on history before then showed an empty
  // (or one-shot-stale) screen. waitForFreshShot polls until it's there.
  //
  // Only wait if extraction actually started (_captureStarted): a shot
  // stopped before any pour (e.g. an immediate manual abort) never gets
  // recorded at all, and waiting out the full timeout for a shot that will
  // never arrive would turn a fast abort into a several-second stall.
  let fullShot = null;
  if (_captureStarted) {
    phase.value = 'saving';
    fullShot = await waitForFreshShot();
  }
  loadHistoryForCurrentRecipe();
  scheduleReviewAutoClose();
  // Matches NSX's real trigger exactly: selecting a recipe never touches
  // lastUsed, only an actually-completed shot does.
  await bumpRecipeLastUsed(recipe.id);

  if (fullShot) notifyStopReason(fullShot);
  await applyPostShotVirtualScale(historyShots.value[0], fullShot);
}

/** Polls the shot list until the shot just brewed shows up for this recipe, so
 *  loadHistoryForCurrentRecipe() never opens on a stale/empty list. Gives up
 *  after a few seconds and returns null — better to open with whatever's
 *  there than spin forever on a shot that never got recorded (e.g. aborted
 *  before extraction, no scale). Returns the full shot detail on success, so
 *  the caller doesn't need a second round-trip for the stop-reason toast. */
async function waitForFreshShot(timeoutMs = 8000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await loadShots(200);
    const candidate = NSXCore.findShotsForWorkflow(recipe, shots.value)[0];
    // Only a shot actually recorded for THIS brew counts as "fresh" — an
    // aborted brew (no scale, or stopped before the pour) persists nothing,
    // so the list's first match could be a stale older shot for this recipe.
    const startedAt = new Date(candidate?.timestamp || candidate?.startTime || 0).getTime();
    if (candidate?.id && startedAt >= shotStartMs.value - 5000) {
      return await NSXCore.getShotDetails(candidate.id).catch(() => null);
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** After a shot ends, surface WHY it stopped (targetWeight / targetVolume /
 *  manual / error / …) as a brief toast. The reason is an open set (see
 *  NSXCore.getShotStopReason) — an unrecognized value falls back to a plain
 *  "Shot ended", and a null reason (legacy / un-sequenced shot) shows nothing. */
function notifyStopReason(fullShot) {
  const reason = NSXCore.getShotStopReason(fullShot);
  if (!reason) return;
  const t = window.NSXI18n?.t || ((k) => k);
  const key = NSXCore.isKnownStopReason(reason) ? `shotStop.${reason}` : 'shotStop.generic';
  NSXCore.emit('toast', t(key));
}

/**
 * Virtual-scale post-shot hook, run after every shot (not just scale-less
 * ones): calibration learning needs a real scale-weight sample to learn
 * from, which is exactly what a shot brewed WITH a scale provides — that's
 * what later lets a scale-less shot estimate weight from the machine's own
 * volume tracking. Mirrors NSX's real _runPostShotActions exactly, just
 * reading the full shot record after the fact instead of live-captured
 * weight/volume variables (Nova's live state doesn't track the machine's
 * volume integration — only actual scale weight/flow are bridged through
 * core's live event stream today).
 */
async function applyPostShotVirtualScale(newShot, prefetchedFull = null) {
  if (!newShot?.id || !recipe.id) return;
  try {
    const fullShot = prefetchedFull ?? await NSXCore.getShotDetails(newShot.id);
    const updatedCal = NSXCore.updateVolumeCalibration(recipe.volumeCalibration, fullShot);
    if (updatedCal !== recipe.volumeCalibration) await saveVolumeCalibration(updatedCal);

    // Estimated-yield annotation — only meaningful for a shot that stopped on
    // VOLUME rather than a real scale: stopAtWeight is on but no scale was
    // connected, so the machine stopped at the profile's target_volume and the
    // real output weight was never measured. `virtualScale: true` is what marks
    // that yield as approximate (resolveActualYield reads it -> history shows a
    // '*'); matches NSX's _runPostShotActions exactly.
    if (!machine.scaleConnected && recipe.stopAtWeight) {
      const { volume } = NSXCore.resolveShotVolumeAndWeight(fullShot);
      const factor = updatedCal?.factor || 1;
      if (Number.isFinite(volume) && volume > 0 && factor > 0) {
        const estimatedYield = Math.round((volume / factor) * 10) / 10;
        // extras merges at field level on the gateway (see CLAUDE.md) — this
        // doesn't clobber any rating/notes/tags already on the shot.
        await NSXCore.updateShot(newShot.id, { annotations: { extras: { actualYield: estimatedYield, virtualScale: true } } });
        // The history screen already landed on this shot (loadHistoryForCurrentRecipe
        // ran in finishLive before this hook) and fetched currentFullShot BEFORE this
        // annotation existed — without a refetch, the just-finished shot would show
        // the raw un-estimated snapshot.volume (ml) instead of the estimated weight
        // + ratio resolveActualYield/resolveActualDose derive from the annotation.
        if (historyShots.value[historyIndex.value]?.id === newShot.id) {
          currentFullShot.value = await NSXCore.getShotDetails(newShot.id).catch(() => currentFullShot.value);
        }
      }
    }
  } catch (err) {
    console.warn('[Nova] virtual scale post-shot update failed', err?.message);
  }
}

/** Opens the history screen for the current recipe directly (the Espresso
 *  screen's History button) — same screen a live shot lands in afterward. */
export function loadHistoryForCurrentRecipe() {
  historyShots.value = NSXCore.findShotsForWorkflow(recipe, shots.value);
  historyIndex.value = 0;
  phase.value = 'history';
}
// finishLive re-schedules the auto-close right after calling the above; a manual
// open must not inherit a pending timer from an earlier post-shot review.

/** Opens the history screen at a SPECIFIC shot within an arbitrary list — the
 *  Diary's bean/profile drill-down uses this to jump straight to a shot the
 *  user tapped, rather than "the current recipe's shots" (loadHistoryForCurrentRecipe).
 *  The overlay is global (mounted once in App.vue), so this works from any tab. */
export function openHistoryAt(shotList, shot) {
  cancelReviewAutoClose();
  const idx = shotList.findIndex((s) => s.id === shot.id);
  historyShots.value = shotList;
  historyIndex.value = idx >= 0 ? idx : 0;
  phase.value = 'history';
}

/**
 * Advances to the profile's next frame — e.g. cutting a preinfusion short.
 * The ONLY shot command the skin sends: stopping (like starting) is left to
 * the machine's own controls, so there is deliberately no on-screen stop.
 *
 * The three guards mirror NSX's (app.js's btn-espresso-fs-skip-step), because
 * the DE1 takes a moment to actually advance and the button invites repeat
 * taps in the meantime:
 *   - in-flight: one request at a time;
 *   - min interval: a double-tap must not eat two frames at once;
 *   - guard frame: once a skip is accepted for frame N, ignore further taps
 *     until the machine reports a different frame, so an unresponsive-feeling
 *     button can't silently skip several steps.
 */
const SKIP_STEP_MIN_INTERVAL_MS = 800;
let _skipInFlight = false;
let _skipGuardFrame = null;
let _skipLastSentAt = 0;

export async function skipStep() {
  if (machine.state !== 'espresso') return;
  if (_skipInFlight) return;
  if (Date.now() - _skipLastSentAt < SKIP_STEP_MIN_INTERVAL_MS) return;
  const frame = Number.isFinite(liveFrame.value) ? liveFrame.value : null;
  if (frame !== null && frame === _skipGuardFrame) return;

  _skipInFlight = true;
  try {
    await NSXApi.setMachineState('skipStep');
    _skipLastSentAt = Date.now();
    if (frame !== null) _skipGuardFrame = frame;
  } finally {
    _skipInFlight = false;
  }
  // A rejection propagates: composables have no `t`, so the caller shows the
  // toast in its own locale (same split as CleaningAssistant's skip).
}

/** `stars` is 0-5 (what the UI shows); the API stores enjoyment as 0-100 —
 *  writing the raw star count would land as a ~1% rating in every other skin. */
export function rateShot(shot, stars) {
  cancelReviewAutoClose();
  const enjoyment = NSXCore.starsToEnjoyment(stars);
  shot.annotations = { ...shot.annotations, enjoyment };
  return NSXCore.updateShot(shot.id, { annotations: { enjoyment } });
}

/** Delete the shot currently shown in the review, drop it from the open list,
 *  and refresh the global shot list so the Diary/full history reflect it.
 *  Closes the review if that was the last shot; otherwise stays on the next one. */
export async function deleteCurrentShot() {
  cancelReviewAutoClose();
  const shot = historyShots.value[historyIndex.value];
  if (!shot?.id) return;
  await NSXCore.deleteShot(shot.id);
  historyShots.value = historyShots.value.filter((s) => s.id !== shot.id);
  await loadShots(200); // keep Diary / full-history in sync with the deletion
  if (!historyShots.value.length) { closeHistory(); return; }
  if (historyIndex.value >= historyShots.value.length) historyIndex.value = historyShots.value.length - 1;
  // The [historyIndex, historyShots] watcher refetches currentFullShot.
}

export function closeHistory() { cancelReviewAutoClose(); phase.value = 'hidden'; }
export function olderShot() { cancelReviewAutoClose(); if (historyIndex.value < historyShots.value.length - 1) historyIndex.value++; }
export function newerShot() { cancelReviewAutoClose(); if (historyIndex.value > 0) historyIndex.value--; }
