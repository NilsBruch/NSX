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
 *  - HOT WATER: dispensed millilitres against the target volume. With a scale
 *    it's the weight delta since start (grams ≈ ml water — how NSX shows it);
 *    without a scale we integrate the live flow (ml/s) ourselves, since the
 *    live MachineSnapshot stream carries no volume (that only exists on the
 *    persisted ShotSnapshot, which the gateway never streams live). Either way
 *    the readout works scale-free instead of falling back to a bare timer.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine, liveShot } from '../composables/useCore.js';
import { steam, hotwater } from '../composables/useMachineFunctions.js';
import LiveRing from './LiveRing.vue';

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
  <LiveRing v-if="isSteam" :value="timeLabel" :progress="steamProgress">
    <button class="rate-btn" @click="stop">{{ t('common.stop') }}</button>
  </LiveRing>

  <!-- Millilitres, from the scale when there is one (a real measurement of what
       landed in the cup) and from the machine's integrated flow when there
       isn't — see the header. Same number either way, so the readout doesn't
       change shape when a scale connects mid-dispense. -->
  <LiveRing v-else-if="isHotWater" :value="String(hwDispensed)" :sub="hwSub" :progress="hwProgress">
    <button class="rate-btn" @click="stop">{{ t('common.stop') }}</button>
  </LiveRing>
</template>
