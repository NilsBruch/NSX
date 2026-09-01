<script setup>
/**
 * Phone shot review — tapping a shot in DiaryTab/ShotsTab calls
 * useLiveShot.js's openHistoryAt(), same as the tablet's Diary drill-down;
 * this renders that SAME shared `phase === 'history'` state (chart, actual
 * dose/yield/ratio, star rating, delete) as LiveShotOverlay.vue's history
 * screen does on the tablet — same composable, same CSS classes (.overlay-full
 * /.shot-graph/.shot-metrics/etc from app.css), so the graph fills whatever
 * vertical space is left exactly like the tablet does, just at phone width.
 * `phase === 'live'` (an in-progress shot) never renders anything here — see
 * useLayout.js: the phone shell is a browse-only companion, LiveShotOverlay
 * stays tablet-only.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  phase, historyShots, historyIndex, currentFullShot,
  closeHistory, olderShot, newerShot, rateShot, setActualDose, setActualYield,
  grindSetting, setGrindSetting, deleteCurrentShot,
} from '../../composables/useLiveShot.js';
import { openNumberPad, openConfirm } from '../../composables/useModals.js';
import ShotStripChart from '../ShotStripChart.vue';
import { skinSettings } from '../../composables/useSettings.js';

const { t } = useI18n();
const { NSXCore } = window;

const LIVE_COLORS = { pressure: '#5fb8a5', flow: '#7fa8c9', wflow: '#ad7648' };

const currentShot = computed(() => historyShots.value[historyIndex.value] ?? null);
const shotSeries = computed(() => (currentFullShot.value ? NSXCore.normalizeShotData(currentFullShot.value) : null));
const historyStripSeries = computed(() => {
  const s = shotSeries.value;
  if (!s) return { elapsed: [], pressure: [], targetPressure: [], flow: [], targetFlow: [], weightFlow: [] };
  return { elapsed: s.elapsed, pressure: s.pressure, targetPressure: s.targetPressure, flow: s.flow, targetFlow: s.targetFlow, weightFlow: s.scaleRate };
});
const dateLabel = computed(() => {
  const shot = currentShot.value;
  if (!shot?.timestamp) return '—';
  const d = new Date(shot.timestamp);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
});
const durationLabel = computed(() => {
  if (!currentFullShot.value) return '—';
  const secs = NSXCore.getShotDurationSeconds(currentFullShot.value);
  return secs != null ? Math.round(secs) : '—';
});
const actualDose = computed(() => (currentFullShot.value ? NSXCore.resolveActualDose(currentFullShot.value) : null));
const actualYield = computed(() => (currentFullShot.value ? NSXCore.resolveActualYield(currentFullShot.value) : { value: null, unit: 'g', estimated: false }));
const fmtWeight = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const ratioLabel = computed(() => {
  const dose = actualDose.value;
  const yieldW = actualYield.value.value;
  return dose && yieldW ? NSXCore.calcRatio(dose, yieldW) : '—';
});
const rating = computed(() => NSXCore.enjoymentToStars(currentShot.value?.annotations?.enjoyment));

// Tapping the currently-set star again clears the rating back to 0 (unrated)
// — otherwise there was no way back down from a rating once given, on either
// this screen or the tablet's (see LiveShotOverlay.vue's matching setRating).
function setRating(n) {
  if (!currentShot.value) return;
  rateShot(currentShot.value, n === rating.value ? 0 : n);
}

const scrub = ref(null);
watch(historyIndex, () => { scrub.value = null; });
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
  <div v-if="phase === 'history'" class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="closeHistory">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('liveShot.back') }}
      </button>
      <span class="ov-title">{{ t('liveShot.historyTitle') }}</span>
      <div class="date-nav">
        <button :disabled="historyIndex >= historyShots.length - 1" @click="olderShot">‹</button>
        <span class="date">{{ dateLabel }}</span>
        <button :disabled="historyIndex <= 0" @click="newerShot">›</button>
      </div>
    </div>

    <template v-if="currentShot">
      <div class="shot-graph">
        <ShotStripChart :series="historyStripSeries" mode="static" :show-targets="skinSettings.showTargets" @scrub="scrub = $event" />
        <div class="glabel glabel-inset">
          <i><span class="sw" :style="{ background: LIVE_COLORS.pressure }"></span>{{ t('liveShot.mPressure') }}<b v-if="scrub"> {{ fmt(scrub.pressure) }}<small>bar</small></b></i>
          <i><span class="sw" :style="{ background: LIVE_COLORS.flow }"></span>{{ t('liveShot.mFlow') }}<b v-if="scrub"> {{ fmt(scrub.flow) }}<small>ml/s</small></b></i>
          <i><span class="sw" :style="{ background: LIVE_COLORS.wflow }"></span>{{ t('liveShot.mWflow') }}<b v-if="scrub"> {{ fmt(scrub.weightFlow) }}<small>g/s</small></b></i>
        </div>
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
</template>
