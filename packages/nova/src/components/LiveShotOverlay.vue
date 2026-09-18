<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { phase, savingShot, series, historyShots, historyIndex, currentFullShot, shotStartMs, skipStep, closeHistory, olderShot, newerShot, rateShot, setActualDose, setActualYield, grindSetting, setGrindSetting, deleteCurrentShot, virtualScaleActive, liveVirtualWeight, liveFrame } from '../composables/useLiveShot.js';
import { recipe } from '../composables/useRecipe.js';
import { skinSettings } from '../composables/useSettings.js';
import { machine, currentWorkflow } from '../composables/useCore.js';
import { openNumberPad, openConfirm } from '../composables/useModals.js';
import { showToast } from '../composables/useToast.js';
import ShotDyePage from './ShotDyePage.vue';
import { formatClock } from '../utils/clock.js';
import { isPhone } from '../composables/useLayout.js';
import ShotStripChart from './ShotStripChart.vue';
import PhaseTicker from './PhaseTicker.vue';
import { frames as profileFrames, frameName } from '../composables/useProfileDisplay.js';
import { dispTemp, tempUnitLabel } from '../composables/useUnits.js';

const { t } = useI18n();
const { NSXCore, NSXApi } = window;

// Shared between the live and history strip charts so a series never changes
// color between the two views. Must match ShotStripChart's internal COLORS:
// pressure green, flow blue, weight-flow coffee brown (the user-facing
// metaphor: water in = blue bars, coffee out = brown fill).
const LIVE_COLORS = { temp: '#e8846f', pressure: '#5fb8a5', flow: '#7fa8c9', wflow: '#ad7648' };
// The expert plot carries its own legend (it's a set of toggles, not a
// caption), so the .glabel captions below are hidden when it's on.
const expertGraph = computed(() => skinSettings.graphMode === 'expert');
const liveElapsedLabel = computed(() => {
  // Index, not Array.prototype.at(): older Android 12 WebViews predate .at()
  // and throw here mid-render, blanking the whole live overlay (works on
  // desktop, not on the tablet — that was the bug).
  const s = series.elapsed.length ? series.elapsed[series.elapsed.length - 1] : 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
});
function last(arr, dec = 1) { return arr.length ? arr[arr.length - 1].toFixed(dec) : '0.0'; }
// ── Phase ticker ──
// The phases of the profile the machine is ACTUALLY running: the resolved
// workflow pushed to the gateway (see buildGatewayPayload) — same source as
// the volume-count lookup in useLiveShot.js, so those two never disagree
// about which frame number means what. `frames()` takes the wrapper record,
// hence the {profile} envelope around the raw profile JSON.
const phaseNames = computed(() => {
  const p = currentWorkflow.value?.profile;
  return profileFrames({ profile: p }).map((f, i) => frameName(f, i, t));
});
// The live chart's temperature scale is fixed around this for the whole shot
// (ShotStripChart's tempRange). From the workflow the machine is actually
// running — same source as the phase names above — and the recipe's own
// temperature only if that has not arrived yet.
const liveTempAnchor = computed(() =>
  NSXCore.resolveProfileTemp(currentWorkflow.value?.profile) ?? (recipe.groupTemp > 0 ? recipe.groupTemp : null));
// profileFrame is 0-based into that same list (core's normalizeShotData
// indexes frames[profileFrame] directly); null until the first snapshot.
const phaseIndex = computed(() => liveFrame.value ?? 0);

// With no scale + volume stop, the weight readout is the machine-flow estimate
// (liveVirtualWeight), not a real scale weight — see useLiveShot.js.
const shownWeight = computed(() => (virtualScaleActive.value ? liveVirtualWeight.value : machine.weight));
const weightPct = computed(() =>
  recipe.targetYield > 0 ? Math.max(0, Math.min(100, (shownWeight.value / recipe.targetYield) * 100)) : 0
);

// ── History ──
// historyShots only carries the lightweight list-endpoint shot (no
// measurements) — the graph, duration, actual dose/yield, and ratio all need
// the FULL record useLiveShot.js fetches into currentFullShot whenever the
// selection changes. currentShot stays around for fields the list item
// already has (timestamp, grinder setting) so those render instantly instead
// of waiting on the extra fetch.
const currentShot = computed(() => historyShots.value[historyIndex.value] ?? null);
const shotSeries = computed(() => {
  if (!currentFullShot.value) return null;
  return NSXCore.normalizeShotData(currentFullShot.value);
});
// Same shape ShotStripChart expects from the live series (useLiveShot.js) —
// scaleRate is normalizeShotData's name for weight-flow.
const historyStripSeries = computed(() => {
  const s = shotSeries.value;
  if (!s) return { elapsed: [], pressure: [], targetPressure: [], flow: [], targetFlow: [], weightFlow: [], temperature: [] };
  // temperature/targetTemperature are read by the expert plot's right-hand
  // scale only — the normal one never draws them (see ShotStripChart).
  return {
    elapsed: s.elapsed, pressure: s.pressure, targetPressure: s.targetPressure,
    flow: s.flow, targetFlow: s.targetFlow, weightFlow: s.scaleRate,
    temperature: s.temperature, targetTemperature: s.targetTemperature,
  };
});
// The recipe tags as RECORDED WITH this shot (workflow.context.extras.tags —
// where pushRecipe puts them, see useRecipe's `tags`), not the recipe's tags as
// they stand today: re-tagging a recipe must not rewrite what past shots say
// about themselves. Same source NSX's shot review reads.
const shotTags = computed(() => {
  const tags = currentFullShot.value?.workflow?.context?.extras?.tags
    ?? currentShot.value?.workflow?.context?.extras?.tags;
  return Array.isArray(tags) ? tags : [];
});

const dateLabel = computed(() => {
  const shot = currentShot.value;
  if (!shot?.timestamp) return '—';
  const d = new Date(shot.timestamp);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
});
const timeLabel = computed(() => {
  const shot = currentShot.value;
  return shot?.timestamp ? formatClock(new Date(shot.timestamp)) : '—';
});
const durationLabel = computed(() => {
  if (!currentFullShot.value) return '—';
  const secs = NSXCore.getShotDurationSeconds(currentFullShot.value);
  return secs != null ? Math.round(secs) : '—';
});
// The DE1/scale only ever measures OUTPUT weight — dose-in is an editable
// annotation (defaulting to the recipe's planned dose), same ceiling NSX's
// own shot review has. Ratio is actual-output ÷ that dose, not the two
// planned recipe targets.
const actualDose = computed(() => (currentFullShot.value ? NSXCore.resolveActualDose(currentFullShot.value) : null));
const actualYield = computed(() => (currentFullShot.value ? NSXCore.resolveActualYield(currentFullShot.value) : { value: null, unit: 'g', estimated: false }));
// resolveActualDose/resolveActualYield pass through raw scale/volume samples,
// which can carry far more precision than the scale actually offers — display
// never shows more than 0.1g, whatever the source data's precision was.
const fmtWeight = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const ratioLabel = computed(() => {
  const dose = actualDose.value;
  const yieldW = actualYield.value.value;
  return dose && yieldW ? NSXCore.calcRatio(dose, yieldW) : '—';
});
// 0-100 enjoyment -> the 0-5 stars this screen renders (see mapping.js).
const rating = computed(() => NSXCore.enjoymentToStars(currentShot.value?.annotations?.enjoyment));

// Tapping the currently-set star again clears the rating back to 0 (unrated)
// — otherwise there was no way back down from a rating once given (the
// recipe rating has this via RatingModal's "Clear" button; this simple
// tap-to-rate row has no modal, so the same star doubles as the clear).
function setRating(n) {
  if (!currentShot.value) return;
  rateShot(currentShot.value, n === rating.value ? 0 : n);
}

// Hold-to-scrub readout: the sample under the finger on the history graph, shown
// inline in the legend. Cleared (null) on release and whenever the shot changes.
const scrub = ref(null);
watch(historyIndex, () => { scrub.value = null; });

// The DYE page sits UNDER the graph page and slides the pair up (see the
// .dye-slider rule). Stepping to another shot leaves it open on purpose: it is
// how you read the same field across several shots.
const dyeOpen = ref(false);
watch(phase, () => { dyeOpen.value = false; });
// Turning the button off (Skin & Display) also takes the page away, rather
// than leaving it open with nothing left to reopen it.
watch(() => skinSettings.dyeButton, (on) => { if (!on) dyeOpen.value = false; });
const fmt = (v, dec = 1) => (Number.isFinite(v) ? v.toFixed(dec) : '—');

async function confirmDeleteShot() {
  const ok = await openConfirm({
    title: t('liveShot.deleteTitle'),
    message: t('liveShot.deleteMessage'),
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (ok) await deleteCurrentShot();
}

// skipStep's own guards (in-flight / interval / already-skipped) return
// quietly; only a real API rejection reaches here and deserves a toast.
async function onSkipStep() {
  try {
    await skipStep();
  } catch {
    showToast(t('liveShot.skipStepFailed'));
  }
}

/**
 * Phone-only. The tablet's own comment on .skip-btn explains why THIS
 * component never offered a stop before now: "that's what the machine's own
 * stop is for, same as starting a shot" — true when you're standing in front
 * of it. On the phone that reasoning runs the other way: you are, by
 * definition, not at the machine, and stopping remotely is the one control
 * this shell keeps (see App.vue's live-overlay comment for the full
 * invariant). Same guard and shape as CleaningAssistant.vue's stop() — no
 * try/catch there either; every stop button in this skin is fire-and-forget
 * once the guard passes.
 */
async function onStop() {
  if (!NSXCore.canExecuteOperation('stopShot', machine.state)) return;
  await NSXApi.setMachineState('idle');
}

async function editActualDose() {
  const v = await openNumberPad({ title: t('liveShot.mIn'), unit: 'g', value: fmtWeight(actualDose.value) === '—' ? '' : fmtWeight(actualDose.value) });
  if (v != null) setActualDose(parseFloat(v));
}

async function editActualYield() {
  const dose = actualDose.value;
  const current = actualYield.value.value;
  const v = await openNumberPad({
    title: t('liveShot.mOut'), unit: 'g',
    value: fmtWeight(current) === '—' ? '' : fmtWeight(current),
    // Same linked-ratio field as the recipe's yield editor: dose is fixed
    // here, so typing either the grams or the 1:x recomputes the other live —
    // which is how the RATIO tile's new value is chosen, not just watched.
    linked: dose > 0 && Number.isFinite(current) ? {
      label: t('espresso.ratio'), unit: '', prefix: '1 : ',
      value: (current / dose).toFixed(1),
      toLinked: (yieldValue) => (yieldValue / dose).toFixed(1),
      toPrimary: (ratioValue) => (Math.round(dose * ratioValue * 10) / 10).toFixed(1),
    } : null,
  });
  if (v != null) setActualYield(parseFloat(v));
}

async function editGrindSetting() {
  const v = await openNumberPad({ title: t('liveShot.mGrind'), value: grindSetting.value ?? '' });
  // Stored as a string, like the recipe's own grinderSetting — a grinder's
  // scale isn't necessarily numeric-with-one-decimal.
  if (v != null) setGrindSetting(String(v));
}
</script>

<template>
  <div v-if="phase === 'live'" class="overlay-full">
    <div class="live-top">
      <span class="live-title">{{ t('liveShot.title') }}</span>
      <PhaseTicker :names="phaseNames" :index="phaseIndex" />
      <!-- Third cell balances the title so the ticker's centre cell is the
           centre of the SCREEN — empty most of the time, but this is also
           where the saving spinner lives once the shot ends (see savingShot
           in useLiveShot.js): a small corner indicator instead of a full-
           screen takeover, so the just-finished graph/metrics stay visible
           while the shot is confirmed saved.
           No top-right timer here: the elapsed time already runs in the
           metrics row below (liveShot.mTime), so a second one would be
           redundant. -->
      <span class="live-top-end">
        <svg v-if="savingShot" viewBox="0 0 24 24" class="saving-spin" role="status" :aria-label="t('liveShot.saving')"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
      </span>
    </div>
    <div class="shot-graph">
      <ShotStripChart :series="series" mode="scroll" :origin-ms="shotStartMs" :show-targets="skinSettings.showTargets" :expert="expertGraph" :temp-anchor="liveTempAnchor" />
      <!-- Inside the plot, top right, rather than on a row of its own below it:
           a legend is a caption for the graph, and it was costing a full row of
           the column for three short words.
           No temperature entry: the strip chart doesn't plot temp (the metric
           tile below carries it) — a legend swatch for an absent line lies. -->
      <div v-if="!expertGraph" class="glabel glabel-inset">
        <i><span class="sw" :style="{ background: LIVE_COLORS.pressure }"></span>{{ t('liveShot.mPressure') }}</i>
        <i><span class="sw" :style="{ background: LIVE_COLORS.flow }"></span>{{ t('liveShot.mFlow') }}</i>
        <i><span class="sw" :style="{ background: LIVE_COLORS.wflow }"></span>{{ t('liveShot.mWflow') }}</i>
      </div>
    </div>
    <div class="live-metrics">
      <div class="metric"><div class="ml" :style="{ color: LIVE_COLORS.temp }">{{ t('liveShot.mTemp') }}</div><div class="mv">{{ dispTemp(last(series.temperature, 0)) }}<small>{{ tempUnitLabel }}</small></div></div>
      <div class="metric"><div class="ml" :style="{ color: LIVE_COLORS.pressure }">{{ t('liveShot.mPressure') }}</div><div class="mv">{{ last(series.pressure) }}<small>bar</small></div></div>
      <div class="metric"><div class="ml" :style="{ color: LIVE_COLORS.flow }">{{ t('liveShot.mFlow') }}</div><div class="mv">{{ last(series.flow) }}<small>ml/s</small></div></div>
      <div class="metric"><div class="ml" :style="{ color: LIVE_COLORS.wflow }">{{ t('liveShot.mWflow') }}</div><div class="mv">{{ last(series.weightFlow) }}<small>g/s</small></div></div>
      <div class="metric"><div class="ml">{{ t('liveShot.mTime') }}</div><div class="mv">{{ liveElapsedLabel }}</div></div>
    </div>
    <div class="live-bottom">
      <div class="live-actions">
        <!-- Skip step only: it advances the profile to its next frame. On the
             tablet, stopping is deliberately NOT offered here — that's what
             the machine's own stop is for, same as starting a shot. This
             button used to be labelled "Skip" but actually stopped the shot.
             Disabled while savingShot: the shot has already ended by then,
             so skipping/stopping no longer means anything. -->
        <button class="skip-btn" :disabled="savingShot" @click="onSkipStep">{{ t('liveShot.skipStep') }}</button>
        <!-- Phone only — see onStop's own comment for why this is the one
             place the tablet's "the machine is right there" reasoning
             doesn't hold. -->
        <button v-if="isPhone" class="stop-btn" :disabled="savingShot" @click="onStop">{{ t('common.stop') }}</button>
      </div>
      <div class="wbar">
        <span class="wbar-label"><b>{{ shownWeight.toFixed(0) }}</b> / {{ recipe.targetYield.toFixed(0) }} g<small v-if="virtualScaleActive" style="color: var(--muted)"> *</small></span>
        <div class="wbar-track">
          <div class="wbar-fill" :style="{ width: `${weightPct}%` }"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Two pages stacked vertically, the graph on top and DYE underneath: the
       DYE button slides the pair up rather than swapping screens, so the graph
       is still where it was when you come back. -->
  <div v-else-if="phase === 'history'" class="overlay-full dye-host">
   <div class="dye-viewport">
    <div class="dye-slider" :class="{ 'is-dye': dyeOpen }">
    <div class="dye-slide">
    <div class="ov-top">
      <button class="ov-back" @click="closeHistory">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('liveShot.back') }}
      </button>
      <span class="ov-title">{{ t('liveShot.historyTitle') }}</span>
      <div class="date-nav">
        <button :disabled="historyIndex >= historyShots.length - 1" @click="olderShot">‹</button>
        <span class="date">
          {{ dateLabel }}
          <small class="date-time">{{ timeLabel }}</small>
        </span>
        <button :disabled="historyIndex <= 0" @click="newerShot">›</button>
      </div>
    </div>

    <template v-if="currentShot">
      <div class="shot-graph">
        <ShotStripChart :series="historyStripSeries" mode="static" :show-targets="skinSettings.showTargets" :expert="expertGraph" @scrub="scrub = $event" />
        <!-- No temperature swatch: the strip chart doesn't plot temp, matching
             the live view exactly (see the request that spawned this). Holding a
             finger on the graph fills each label with that point's value. -->
        <div v-if="!expertGraph" class="glabel glabel-inset">
          <i><span class="sw" :style="{ background: LIVE_COLORS.pressure }"></span>{{ t('liveShot.mPressure') }}<b v-if="scrub"> {{ fmt(scrub.pressure) }}<small>bar</small></b></i>
          <i><span class="sw" :style="{ background: LIVE_COLORS.flow }"></span>{{ t('liveShot.mFlow') }}<b v-if="scrub"> {{ fmt(scrub.flow) }}<small>ml/s</small></b></i>
          <i><span class="sw" :style="{ background: LIVE_COLORS.wflow }"></span>{{ t('liveShot.mWflow') }}<b v-if="scrub"> {{ fmt(scrub.weightFlow) }}<small>g/s</small></b></i>
        </div>
      </div>
      <!-- Read-only: these are what the recipe carried when the shot was
           pulled. Editing tags is a recipe action (the card hold menu). -->
      <div v-if="skinSettings.showTags && shotTags.length" class="shot-tags">
        <span class="st-label">{{ t('liveShot.shotTags') }}</span>
        <span v-for="tag in shotTags" :key="tag" class="st-tag">{{ tag }}</span>
      </div>
      <div class="shot-metrics">
        <button class="metric as-btn" @click="editGrindSetting">
          <div class="ml">{{ t('liveShot.mGrind') }}</div><div class="mv">{{ grindSetting ?? '—' }}</div>
        </button>
        <button class="metric as-btn" @click="editActualDose">
          <div class="ml">{{ t('liveShot.mIn') }}</div><div class="mv">{{ fmtWeight(actualDose) }}<small>g</small></div>
        </button>
        <button class="metric as-btn" @click="editActualYield">
          <div class="ml">{{ t('liveShot.mOut') }}</div><div class="mv">{{ fmtWeight(actualYield.value) }}<small>{{ actualYield.unit }}{{ actualYield.estimated ? '*' : '' }}</small></div>
        </button>
        <div class="metric"><div class="ml">{{ t('liveShot.mRatio') }}</div><div class="mv">{{ ratioLabel }}</div></div>
        <div class="metric"><div class="ml">{{ t('liveShot.mTime') }}</div><div class="mv">{{ durationLabel }}<small>s</small></div></div>
      </div>
      <div class="shot-done">
        <!-- Bottom left, opposite Delete: the way DOWN into the rest of this
             shot's record. Everything the graph page has no room for lives
             there (ShotDyePage.vue). -->
        <button v-if="skinSettings.dyeButton" class="shot-dye" @click="dyeOpen = true">
          {{ t('dye.open') }}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7" /></svg>
        </button>
        <div class="rate-stars">
          <button v-for="n in 5" :key="n" class="star" :class="{ on: n <= rating }" @click="setRating(n)">{{ n <= rating ? '★' : '☆' }}</button>
        </div>
        <button class="shot-delete" :aria-label="t('common.delete')" @click="confirmDeleteShot">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" /></svg>
          {{ t('common.delete') }}
        </button>
      </div>
    </template>
    <div v-else class="list"><div class="list-row"><span class="rsub">{{ t('liveShot.noShotsYet') }}</span></div></div>
    </div>
    <ShotDyePage class="dye-slide" @close="dyeOpen = false" />
    </div>
   </div>
  </div>
</template>
