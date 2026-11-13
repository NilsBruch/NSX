<script setup>
/**
 * Steam/hot-water's live view: a simple progress readout + stop, not the full
 * pressure/flow/temp graph — that's reserved for espresso (see the design log:
 * "Steam/Hotwater-Live: schlichter Fortschritt/Timer"). Global overlay, same
 * reasoning as LiveShotOverlay: a hardware-triggered dispense can start from
 * any tab.
 *
 * Both are drawn as the centred LiveRing over a blurred page, the same
 * treatment as the flush: hands-on, seconds long, one number worth looking at,
 * and no reason to replace the page for it. The ring runs in opposite
 * directions for the two — steam's DRAINS towards zero, hot water's FILLS
 * towards the target — which is exactly what each readout means.
 *
 * Two readouts, one per beverage:
 *  - STEAM: a timer. Counts only the active pour (substate 'pouring'; the
 *    'steam' state also covers wand heat-up, so the anchor is the first pour,
 *    not the state transition — mirrors NSX's steamSession). Direction follows
 *    the auto-stop toggle: on counts DOWN from the dialed duration, off up.
 *    Flanking the timer are the live readings that actually move while
 *    steaming — boiler temperature on one side, flow and pressure stacked on
 *    the other — and a Show-graph toggle opens
 *    the temperature / flow / pressure plot underneath for anyone who wants to
 *    watch the steam curve rather than just the clock. The ring alone said
 *    nothing about how the machine was doing, which is what made the steam
 *    screen feel empty.
 *  - HOT WATER: dispensed millilitres against the target volume. With a scale
 *    it's the weight delta since start (grams ≈ ml water — how NSX shows it);
 *    without a scale we integrate the live flow (ml/s) ourselves, since the
 *    live MachineSnapshot stream carries no volume (that only exists on the
 *    persisted ShotSnapshot, which the gateway never streams live). Either way
 *    the readout works scale-free instead of falling back to a bare timer.
 */
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine, liveShot } from '../composables/useCore.js';
import { steam, hotwater } from '../composables/useMachineFunctions.js';
import { dispTemp, tempUnitLabel } from '../composables/useUnits.js';
import LiveRing from './LiveRing.vue';
import ShotStripChart from './ShotStripChart.vue';

const { t } = useI18n();
const { NSXCore, NSXApi } = window;

// Both states share the one timer/lifecycle below, so they're watched as a set
// rather than with two separate watches.
const LIVE_STATES = ['steam', 'hotWater'];
const isSteam = computed(() => machine.state === 'steam');
const isHotWater = computed(() => machine.state === 'hotWater');

// ── Hot water: dispensed ml. Scale weight delta since start when a scale is
// connected (a real measurement); otherwise the machine's flow-integrated
// volume, which already accumulates from shot start so it needs no offset. ──
let startWeight = 0;
const flowVolume = ref(0); // ml integrated from live flow (no-scale path)
const hwTarget = computed(() => Math.round(hotwater.volume || 0));
const hwDispensed = computed(() =>
  machine.scaleConnected
    ? Math.max(0, Math.round((machine.weight ?? 0) - startWeight))
    : Math.max(0, Math.round(flowVolume.value))
);
// The ring FILLS as water is delivered. No target set -> nothing to fill
// towards, so it stays indeterminate and the millilitres just count up.
const hwProgress = computed(() =>
  hwTarget.value > 0 ? Math.min(1, hwDispensed.value / hwTarget.value) : null
);
const hwSub = computed(() => (hwTarget.value > 0 ? `/ ${hwTarget.value} ml` : 'ml'));

// ── Steam readouts: the two numbers that move while steaming ────────────────
// steamTemperature is the machine's own boiler reading (0/absent when it
// isn't reporting one — shown as a dash rather than a confident 0°C).
const steamTemp = computed(() => (liveShot.steamTemperature > 0 ? liveShot.steamTemperature : null));
const steamTempLabel = computed(() => (steamTemp.value == null ? '—' : String(dispTemp(steamTemp.value))));
const steamFlowLabel = computed(() => (liveShot.flow || 0).toFixed(1));
const steamPressureLabel = computed(() => (liveShot.pressure || 0).toFixed(1));

// ── The steam curve ─────────────────────────────────────────────────────────
// Sampled by the tick below for as long as the machine is steaming, whether or
// not the graph is open — opening it mid-steam should show what has happened
// so far, not start from the moment of the tap.
//
// The same parallel-array shape ShotStripChart takes from the live shot. The
// target series stay empty because steam runs no profile to have targets from,
// and weightFlow stays empty because there is no scale under a steam jug —
// both are `omit`ted from the chart's legend rather than drawn flat at zero.
// SAMPLE_CAP bounds a wand left open: 250ms samples, so ~10 minutes.
const SAMPLE_CAP = 2400;
const steamSeries = reactive({
  elapsed: [], pressure: [], targetPressure: [], flow: [], targetFlow: [],
  weightFlow: [], temperature: [],
});
const showGraph = ref(false);
const graphOriginMs = ref(0);

/**
 * The curve is the POUR, and nothing else.
 *
 * Measured on a real DE1XXL (fw 1333), a steam walks:
 *
 *   steam/preparingForShot   3.1s   the wand opening, flow ramping
 *   steam/pouring            9.8s   the actual steam
 *   steam/pouringDone       11.5s   decay: targetFlow 0, pressure bleeding off
 *   idle/idle
 *
 * The tail was LONGER than the steam, so over half the plot was a curve
 * falling to nothing — which is what made the chart look wrong. The ramp
 * before it is no more interesting: it is the wand clearing, not the milk.
 *
 * Active steam is `substate === 'pouring'` AND the machine still COMMANDING
 * it (targetFlow > 0) — NSX's rule, whose comment records the DE1 sometimes
 * holding 'pouring' after dropping targetFlow to 0 (it measured that tail
 * inflating a 5s steam to 12s). Both halves earn their place: across 75
 * pouring samples targetFlow never once hit 0, while during pouringDone it
 * bounced back up to 4.0 — so a targetFlow-only rule would have un-frozen
 * mid-tail, and a substate-only rule would miss the case NSX documents.
 */
let steamSawCommand = false;   // has targetFlow ever been reported > 0?
let steamWasActive = false;    // has the real pour started?
let steamIdleTicks = 0;        // consecutive inactive samples since it did
const steamFrozen = ref(false);

function resetSteamSeries() {
  for (const key of Object.keys(steamSeries)) steamSeries[key].length = 0;
  steamSawCommand = false;
  steamWasActive = false;
  steamIdleTicks = 0;
  steamFrozen.value = false;
}

function sampleSteam(now) {
  if (steamFrozen.value) return;

  const pouring = machine.substate === 'pouring';
  const commanded = (liveShot.targetFlow || 0) > 0;
  if (commanded) steamSawCommand = true;
  // targetFlow is the better signal, but only once this machine has shown it
  // reports one during steam at all — otherwise a gateway that leaves it at 0
  // would read as "never pouring" and the curve would never freeze, which is
  // exactly the behaviour being fixed.
  const active = pouring && (steamSawCommand ? commanded : true);

  if (!active) {
    // Before the pour there is nothing to draw yet; after it, the two-tick
    // wait (500ms) is only about WHEN to freeze, never about plotting more —
    // one dropped or transient sample must not be able to end the curve
    // mid-pour, and freezing is not undoable.
    if (steamWasActive && ++steamIdleTicks >= 2) steamFrozen.value = true;
    return;
  }
  if (!steamWasActive) {
    steamWasActive = true;
    // x starts where the steam does, not where the state did: the ramp before
    // it is no longer plotted, so an origin at state-entry would open the
    // chart with three seconds of empty axis.
    graphOriginMs.value = now;
  }
  steamIdleTicks = 0;

  if (steamSeries.elapsed.length >= SAMPLE_CAP) return;
  steamSeries.elapsed.push((now - graphOriginMs.value) / 1000);
  steamSeries.pressure.push(liveShot.pressure || 0);
  steamSeries.flow.push(liveShot.flow || 0);
  steamSeries.temperature.push(steamTemp.value ?? 0);
}

// ── Timer (steam only; hot water shows ml, not a timer) ──────────────────────
// Steam advances only while actively pouring; hot water isn't timed.
const advancing = computed(() => (isSteam.value ? machine.substate === 'pouring' : true));
// Count DOWN only while steaming with the auto-stop timer on; otherwise up.
const countdown = computed(() => isSteam.value && steam.timerEnabled);

let startMs = 0;
let lastTickMs = 0;
let timer = null;
const elapsedSec = ref(0);

const timeLabel = computed(() => {
  const sec = Math.floor(elapsedSec.value);
  const shown = countdown.value ? Math.max(0, Math.round(steam.duration) - sec) : sec;
  return `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
});

// Only a timed steam has an end to run down to; with auto-stop off the ring
// stays full (LiveRing's null = indeterminate) rather than implying a target
// the machine isn't working towards.
const steamProgress = computed(() => {
  if (!countdown.value || !(steam.duration > 0)) return null;
  return Math.max(0, Math.min(1, (steam.duration - elapsedSec.value) / steam.duration));
});

function tick() {
  const now = Date.now();
  // Hot water without a scale: integrate live flow (ml/s) into dispensed ml —
  // the gateway does exactly this to build ShotSnapshot.volume, but there is no
  // live ShotSnapshot stream, so we integrate the MachineSnapshot's flow here.
  if (isHotWater.value && !machine.scaleConnected) {
    flowVolume.value += (liveShot.flow || 0) * (now - lastTickMs) / 1000;
  }
  lastTickMs = now;
  // Before the advancing guard because sampleSteam keeps its own notion of
  // when the pour starts and ends (see there) — the timer's is not the same
  // question.
  if (isSteam.value) sampleSteam(now);
  if (!advancing.value) return;               // steam: freeze between/after pours
  if (startMs === 0) startMs = now;
  elapsedSec.value = (now - startMs) / 1000;
}

watch(
  () => machine.state,
  (state, prev) => {
    const entering = LIVE_STATES.includes(state) && !LIVE_STATES.includes(prev);
    const leaving = !LIVE_STATES.includes(state) && LIVE_STATES.includes(prev);
    if (entering) {
      startMs = 0;
      lastTickMs = Date.now();
      elapsedSec.value = 0;
      flowVolume.value = 0;
      startWeight = machine.weight ?? 0;       // tare-relative dispense baseline
      graphOriginMs.value = Date.now();
      resetSteamSeries();
      // The graph closes with the session rather than staying open for the
      // next one: whether you want to watch the curve is a per-steam decision.
      showGraph.value = false;
      tick();
      timer = setInterval(tick, 250);
    } else if (leaving && timer) {
      clearInterval(timer);
      timer = null;
    }
  }
);
onUnmounted(() => { if (timer) clearInterval(timer); });

async function stop() {
  if (!NSXCore.canExecuteOperation('setState', machine.state)) return;
  await NSXApi.setMachineState('idle');
}
</script>

<template>
  <LiveRing v-if="isSteam" :value="timeLabel" :progress="steamProgress" :raised="showGraph">
    <!-- Temperature left, flow right — the two readings the machine is
         actually working on while the timer counts. -->
    <template #left>
      <div class="sl-stat">
        <div class="sl-sv">{{ steamTempLabel }}<small>{{ tempUnitLabel }}</small></div>
        <div class="sl-sl">{{ t('hotwater.temperature') }}</div>
      </div>
    </template>
    <template #right>
      <div class="sl-stat">
        <div class="sl-sv">{{ steamFlowLabel }}<small>ml/s</small></div>
        <div class="sl-sl">{{ t('cleaning.flow') }}</div>
      </div>
      <!-- Stacked under flow: the two hydraulic readings side by side with the
           ring, temperature alone on the other side. -->
      <div class="sl-stat sl-stat-next">
        <div class="sl-sv">{{ steamPressureLabel }}<small>bar</small></div>
        <div class="sl-sl">{{ t('liveShot.mPressure') }}</div>
      </div>
    </template>
    <button class="rate-btn" @click="stop">{{ t('common.stop') }}</button>
    <button class="rate-btn sl-ghost" @click="showGraph = !showGraph">
      {{ showGraph ? t('steam.hideGraph') : t('steam.showGraph') }}
    </button>
  </LiveRing>

  <!-- Expert mode regardless of the skin's graph setting: temperature is the
       series this graph is FOR, and the normal strip chart deliberately
       doesn't plot it (it's an extraction-dynamics view). Scroll mode, like
       the live shot — a steam is watched as it happens. -->
  <div v-if="isSteam && showGraph" class="sl-graph">
    <!-- Both scales pinned rather than fitted. Steam pressure and flow live
         well under a shot's 0-12, which squashed the whole curve into the
         bottom third; and the wand's working temperature is a known band, so
         fixing it is what makes two steams the same picture instead of two
         differently-scaled ones. -->
    <ShotStripChart
      :series="steamSeries" mode="scroll" :origin-ms="graphOriginMs" :window-s="35"
      :max-y="8" :temp-band="[135, 170]"
      expert :omit="['weight', 'goals']" :stopped="steamFrozen"
    />
  </div>

  <!-- Millilitres, from the scale when there is one (a real measurement of what
       landed in the cup) and from the machine's integrated flow when there
       isn't — see the header. Same number either way, so the readout doesn't
       change shape when a scale connects mid-dispense. -->
  <LiveRing v-if="isHotWater" :value="String(hwDispensed)" :sub="hwSub" :progress="hwProgress">
    <button class="rate-btn" @click="stop">{{ t('common.stop') }}</button>
  </LiveRing>
</template>

<style scoped>
/* The flanking readouts. Same tile shape as the live shot's metrics (label
   under value, unit as a small suffix), scaled down — the ring's own number is
   the headline and these two must stay secondary to it. */
.sl-stat { pointer-events: none; }
.sl-stat-next { margin-top: 14px; }
.sl-sv {
  font-size: var(--fs-lg); font-weight: 700; line-height: 1;
  font-variant-numeric: tabular-nums;
}
.sl-sv small { font-size: var(--fs-xs); font-weight: 600; margin-left: 2px; color: var(--muted); }
.sl-sl {
  margin-top: 4px; font-size: var(--fs-xs); font-weight: 600;
  color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase;
}

/* Secondary next to Stop: stopping the steam is the action this screen is
   for, and a second filled accent button would compete with it. */
.sl-ghost {
  background: var(--card-bg); color: var(--text);
  min-width: 200px; box-shadow: var(--elev-1);
}

/* The lower half of the screen, under the raised ring. Above the scrim (which
   sits at z-index 13, the ring at 14) and interactive, since the expert plot's
   legend toggles series. */
.sl-graph {
  position: fixed; z-index: 14;
  left: 50%; transform: translateX(-50%);
  top: 54%; width: min(760px, 92vw); height: 230px;
  padding: 12px 14px;
  border-radius: var(--r-lg); background: var(--card-bg); box-shadow: var(--elev-2);
  pointer-events: auto;
  animation: sl-graph-in 0.22s ease-out;
}
@keyframes sl-graph-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
}
@media (prefers-reduced-motion: reduce) {
  .sl-graph { animation: none; }
}
</style>
