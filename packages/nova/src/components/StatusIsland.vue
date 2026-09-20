<script setup>
/**
 * The status island: machine state, clock, water level, scale indicator, and a
 * heating progress ring drawn around the pill's own border.
 *
 * The ring is driven purely by TEMPERATURE, not a timer: it fills as the live
 * group temperature climbs toward (target - 10°C), where target is the loaded
 * recipe's group temp (falling back to a sensible default when no recipe is
 * loaded). Once the group is within 10°C of target the ring vanishes.
 *
 * The machine's own estimate (the time-to-ready plugin, bridged to
 * machine.timeToReadyMs) is shown as a COUNTDOWN NEXT TO THE LABEL, and
 * deliberately does not drive the ring. That distinction is the whole lesson
 * of the earlier attempt: the estimate gets revised, and a progress arc that
 * runs backwards reads as broken, while a number that jumps from 2:10 to 2:40
 * reads as the machine changing its mind — which is exactly what happened.
 * So: temperature answers "how far along", the plugin answers "how long", and
 * neither is asked to do the other's job.
 *
 * The plugin is optional and not installed on every gateway. Nothing here
 * requires it: with no estimate arriving, the island renders precisely as it
 * did before.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine, liveShot } from '../composables/useCore.js';
import { recipe } from '../composables/useRecipe.js';
import { steam } from '../composables/useMachineFunctions.js';
import { skinSettings } from '../composables/useSettings.js';
import { showToast } from '../composables/useToast.js';
import { formatClock } from '../utils/clock.js';
import { fmtTemp } from '../composables/useUnits.js';
import { formatWaterLevel } from '../utils/water.js';

const { t } = useI18n();
const { NSXApi } = window;

// Same connect-or-tare behaviour as Settings' ScaleWidget: disconnected ->
// initiate pairing; connected -> tare. The icon is the same oval scale
// silhouette the Espresso screen used to show (that standalone ScalePod.vue
// was removed once the island carried the same info).
async function onScaleTap() {
  if (!machine.scaleConnected) {
    try {
      await NSXApi.initiateScaleConnect();
      showToast(t('toast.scaleConnecting'));
    } catch (err) {
      console.error('[Nova] scale connect failed', err);
    }
    return;
  }
  try {
    await NSXApi.tareScale();
    showToast(t('toast.scaleTared'));
  } catch (err) {
    showToast(t('toast.tareFailed') + ': ' + err.message);
  }
}
const weightLabel = computed(() => `${machine.weight.toFixed(1)}g`);
// The tank level arrives as native millimetres (a noisy float) — format it in
// the user's chosen unit (default ml, rounded to 10). See utils/water.js.
const waterLabel = computed(() => formatWaterLevel(machine.water.currentLevel, skinSettings.waterUnit));

const ICONS = {
  water: '<path d="M12 3.5s5.5 6.3 5.5 10a5.5 5.5 0 0 1-11 0c0-3.7 5.5-10 5.5-10z"/><path d="M9.5 14.5a2.8 2.8 0 0 0 2.3 2.7"/>',
  thermo: '<path d="M10 4a2 2 0 0 1 4 0v9a4.5 4.5 0 1 1-4 0V4z"/><path d="M12 9v6"/>',
  steam: '<path d="M6 20c1.6-1 1.6-3 0-4s-1.6-3 0-4"/><path d="M12 20c1.6-1 1.6-3 0-4s-1.6-3 0-4"/><path d="M18 20c1.6-1 1.6-3 0-4s-1.6-3 0-4"/>',
};

// liveShot.groupTemperature streams off the always-on machine-snapshot socket
// (~250ms), not just during a shot — see useCore.js — so it's a genuine live
// reading, not a stale "last shot" value.
const groupTempLabel = computed(() => fmtTemp(liveShot.groupTemperature));
// Actual steam-boiler temperature from the live machine snapshot (the same
// snap.steamTemperature field NSX reads). Falls back to the configured steam
// target when the machine isn't reporting a live value (idle / not finite).
const steamTempLabel = computed(() => {
  const live = Number(liveShot.steamTemperature);
  const shown = Number.isFinite(live) && live > 0 ? live : steam.temp;
  return fmtTemp(shown);
});

const HEATING_STATES = new Set(['heating', 'preheating']);
const ALERT_STATES = new Set(['needsWater', 'error']);
// How far below target still counts as "heating". At/above (target - READY_MARGIN)
// the group is close enough to brew, so the ring clears.
const READY_MARGIN_C = 10;
// No recipe loaded -> compare against a sensible espresso target so warmup still
// shows a ring on a fresh boot.
const DEFAULT_TARGET_C = 90;
const targetTemp = computed(() => Number(recipe.groupTemp) > 0 ? Number(recipe.groupTemp) : DEFAULT_TARGET_C);

// Heating = the machine says so, or it is IDLE and still short of target. The
// temperature test only ever refines 'idle' — "on, but not there yet" is the
// one thing the machine's own state word cannot tell apart, and every other
// state already names itself. It used to run on temperature alone, which made
// a sleeping machine read as "Heating" as soon as the group cooled below
// target-10 (i.e. a few minutes after being put to sleep, and on every cold
// boot) — the machine was doing nothing at all.
const heatingActive = computed(() => {
  if (!machine.connected) return false;
  if (HEATING_STATES.has(machine.state)) return true;
  if (machine.state !== 'idle') return false;
  const temp = Number(liveShot.groupTemperature);
  return Number.isFinite(temp) && temp > 0 && temp < targetTemp.value - READY_MARGIN_C;
});

const statusClass = computed(() => {
  if (!machine.connected) return 'alert';
  if (heatingActive.value) return 'heating';
  if (machine.state === 'idle') return 'ready';
  if (ALERT_STATES.has(machine.state)) return 'alert';
  return '';
});

const statusLabel = computed(() => {
  if (!machine.connected) return t('status.noMachine');
  if (heatingActive.value) return t('status.heating');
  const key = machine.state === 'idle' ? 'ready' : machine.state;
  return t(`status.${key}`);
});

// ── Heating ring: fills from cold up to (target - READY_MARGIN) ──
// Assumes a cold start near room temperature; the ring reads as "how far through
// the warmup are we", 0% cold -> 100% at the ready threshold.
const COLD_START_C = 20;
const heatingPct = computed(() => {
  if (!heatingActive.value) return null;
  const temp = Number(liveShot.groupTemperature);
  if (!Number.isFinite(temp)) return null;
  const ready = targetTemp.value - READY_MARGIN_C;
  const span = ready - COLD_START_C;
  if (span <= 0) return null;
  const pct = 100 * ((temp - COLD_START_C) / span);
  return Math.max(0, Math.min(100, pct));
});

// ── Time to ready: the machine's own estimate ──
// Interpolated between pushes rather than shown only when one lands: the
// plugin's cadence isn't ours to assume (it is a separate reaplugin, and this
// socket can go quiet for seconds at a time), and a countdown that freezes
// looks more broken than one that is a second or two out. Every push re-syncs
// the anchor, so drift can never accumulate.
const ttrAnchor = ref(null); // { ms, at } — the last estimate and when it arrived
watch(
  () => machine.timeToReadyMs,
  (ms) => { ttrAnchor.value = Number.isFinite(ms) && ms > 0 ? { ms, at: Date.now() } : null; },
  { immediate: true }
);

const ttrTick = ref(Date.now());
let ttrTimer = null;

const readyInLabel = computed(() => {
  // Only while actually heating: the estimate lingers at its last value after
  // the machine arrives, and a countdown next to "Ready" is nonsense.
  if (!heatingActive.value || !ttrAnchor.value) return null;
  const left = ttrAnchor.value.ms - (ttrTick.value - ttrAnchor.value.at);
  if (left <= 0) return null; // overshot its own estimate — say nothing rather than 0:00
  const sec = Math.ceil(left / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
});

// ── Clock: minute resolution, so a 15s tick is plenty ──
const now = ref(new Date());
let clockTimer = null;
onMounted(() => {
  clockTimer = setInterval(() => { now.value = new Date(); }, 15_000);
  ttrTimer = setInterval(() => { ttrTick.value = Date.now(); }, 1000);
});
onUnmounted(() => {
  clearInterval(clockTimer);
  clearInterval(ttrTimer);
});

const clockLabel = computed(() => formatClock(now.value));
</script>

<template>
  <div class="status-island">
    <svg v-if="heatingPct != null" class="heat-ring" viewBox="0 0 600 30" preserveAspectRatio="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="597" height="27" rx="14" pathLength="100" :style="{ strokeDashoffset: 100 - heatingPct }" />
    </svg>

    <span class="st-left">
      <span class="st-state" :class="statusClass">
        <span class="st-dot" :class="statusClass"></span>
        {{ statusLabel }}<span v-if="readyInLabel" class="st-ttr">{{ readyInLabel }}</span>
      </span>
      <button class="st-item st-scale-btn" :class="{ off: !machine.scaleConnected }" :aria-label="t('machineSettings.scale')" @click="onScaleTap">
        <svg class="st-scale-icon" viewBox="0 0 110 70" aria-hidden="true" fill="currentColor">
          <defs>
            <clipPath id="st-scale-oval-clip"><rect x="0" y="0" width="110" height="70" rx="35" /></clipPath>
          </defs>
          <rect x="0" y="0" width="110" height="70" rx="35" />
          <rect x="0" y="53" width="110" height="17" fill="rgba(0,0,0,0.35)" clip-path="url(#st-scale-oval-clip)" />
        </svg>
        <template v-if="machine.scaleConnected">{{ weightLabel }}</template>
      </button>
    </span>

    <span class="st-mid">{{ clockLabel }}</span>

    <span class="st-right">
      <span v-if="machine.water.currentLevel != null" class="st-item">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.water"></svg>{{ waterLabel }}
      </span>
      <span v-if="machine.connected" class="st-item" :aria-label="t('espresso.stopAtTemp')">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.thermo"></svg>{{ groupTempLabel }}
      </span>
      <span v-if="machine.connected" class="st-item" :aria-label="t('tab.steam')">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.steam"></svg>{{ steamTempLabel }}
      </span>
    </span>
  </div>
</template>
