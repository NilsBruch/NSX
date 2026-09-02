<script setup>
/**
 * The Schedule page holds two independent things:
 *   - the weekly power schedule (enabled / per-day / wake+sleep times), driven
 *     by NSXCore's schedule domain via scheduleState + applySchedule; only the
 *     WAKE time is synced to the gateway (see core/domains/schedule.js), which
 *     is what "wakes when you want" means — sleep is the machine's own auto-off.
 *   - night mode (a separate, simpler gateway setting below).
 */
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { openWheel } from '../../composables/useModals.js';
import {
  appSettings, loadAppSettings, saveAppSetting,
  scheduleState, applySchedule,
} from '../../composables/useSettings.js';

defineEmits(['close']);
const { t } = useI18n();

onMounted(loadAppSettings);

function pad2(n) { return String(n).padStart(2, '0'); }
function timeValues() {
  const out = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) out.push(`${pad2(h)}:${pad2(m)}`);
  return out;
}

// ── Weekly power schedule ─────────────────────────────────────────────────
const DAYS = [1, 2, 3, 4, 5, 6, 7];
function toggleDay(d) {
  const days = scheduleState.days.includes(d)
    ? scheduleState.days.filter((x) => x !== d)
    : [...scheduleState.days, d].sort();
  applySchedule({ days });
}
async function editScheduleTime(hourKey, minuteKey, label) {
  const current = `${pad2(scheduleState[hourKey])}:${pad2(scheduleState[minuteKey])}`;
  const v = await openWheel({ title: label, values: timeValues(), current });
  if (v == null) return;
  const [h, m] = v.split(':').map(Number);
  applySchedule({ [hourKey]: h, [minuteKey]: m });
}

// Night mode (appSettings.nightMode*) is a separate, simpler gateway setting
// from the weekly on/off schedule above — pauses charging overnight rather
// than powering the machine off — stored as minutes-of-day (e.g. 1320 = 22:00).
function minutesToHHMM(mins) {
  const m = ((Number(mins) || 0) % 1440 + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
async function editNightTime(key, label) {
  const v = await openWheel({ title: label, values: timeValues(), current: minutesToHHMM(appSettings[key]) });
  if (v == null) return;
  saveAppSetting(key, hhmmToMinutes(v));
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ t('settingsPage.schedule') }}</span>
    </div>

    <div class="settings-scroll">
      <span class="setting-group-label">{{ t('scheduleSettings.title') }}</span>
      <div class="setting-row">
        <span class="sr-main"><span class="sr-name">{{ t('scheduleSettings.enabled') }}</span><span class="sr-sub">{{ t('scheduleSettings.enabledSub') }}</span></span>
        <button class="switch" :class="{ on: scheduleState.enabled }" role="switch" :aria-checked="scheduleState.enabled" @click="applySchedule({ enabled: !scheduleState.enabled })"></button>
      </div>
      <template v-if="scheduleState.enabled">
        <button class="setting-row as-btn" @click="editScheduleTime('onHour', 'onMinute', t('scheduleSettings.wake'))">
          <span class="sr-name">{{ t('scheduleSettings.wake') }}</span>
          <span class="sr-value">{{ pad2(scheduleState.onHour) }}:{{ pad2(scheduleState.onMinute) }}<span class="sr-chev">›</span></span>
        </button>
        <button class="setting-row as-btn" @click="editScheduleTime('offHour', 'offMinute', t('scheduleSettings.sleep'))">
          <span class="sr-name">{{ t('scheduleSettings.sleep') }}</span>
          <span class="sr-value">{{ pad2(scheduleState.offHour) }}:{{ pad2(scheduleState.offMinute) }}<span class="sr-chev">›</span></span>
        </button>
        <div class="setting-row">
          <span class="sr-name">{{ t('scheduleSettings.days') }}</span>
          <div class="day-toggles">
            <button
              v-for="d in DAYS"
              :key="d"
              class="day-chip"
              :class="{ on: scheduleState.days.includes(d) }"
              :aria-label="t(`scheduleSettings.day${d}`)"
              @click="toggleDay(d)"
            >{{ t(`scheduleSettings.day${d}`)[0] }}</button>
          </div>
        </div>
      </template>

      <span class="setting-group-label">{{ t('scheduleSettings.nightMode') }}</span>
      <div class="setting-row">
        <span class="sr-main"><span class="sr-name">{{ t('scheduleSettings.nightModeEnabled') }}</span><span class="sr-sub">{{ t('scheduleSettings.nightModeSub') }}</span></span>
        <button class="switch" :class="{ on: appSettings.nightModeEnabled }" role="switch" :aria-checked="!!appSettings.nightModeEnabled" @click="saveAppSetting('nightModeEnabled', !appSettings.nightModeEnabled)"></button>
      </div>
      <template v-if="appSettings.nightModeEnabled">
        <button class="setting-row as-btn" @click="editNightTime('nightModeSleepTime', t('scheduleSettings.nightSleep'))">
          <span class="sr-name">{{ t('scheduleSettings.nightSleep') }}</span>
          <span class="sr-value">{{ minutesToHHMM(appSettings.nightModeSleepTime) }}<span class="sr-chev">›</span></span>
        </button>
        <button class="setting-row as-btn" @click="editNightTime('nightModeMorningTime', t('scheduleSettings.nightWake'))">
          <span class="sr-name">{{ t('scheduleSettings.nightWake') }}</span>
          <span class="sr-value">{{ minutesToHHMM(appSettings.nightModeMorningTime) }}<span class="sr-chev">›</span></span>
        </button>
      </template>
    </div>
  </div>
</template>
