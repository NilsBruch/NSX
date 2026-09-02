<script setup>
/**
 * When the machine cools down and when it wakes — the two power questions that
 * used to be a tile away, in MachinePanel (auto sleep) and SchedulePanel (the
 * weekly plan) respectively. They belong side by side: both answer "when is
 * the machine hot", and neither is worth a screen of its own.
 *
 * This replaces the Schedule tile outright. Night mode, the panel's other
 * half, moved to AppPanel's Power & charging group instead — it pauses the
 * TABLET's charging overnight and never had anything to do with the machine's
 * power, which is what this card is about.
 */
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { openWheel, openNumberPad } from '../../composables/useModals.js';
import {
  presenceSettings, loadPresenceSettings, savePresenceSetting,
  scheduleState, applySchedule,
} from '../../composables/useSettings.js';

const { t } = useI18n();

onMounted(loadPresenceSettings);

const pad2 = (n) => String(n).padStart(2, '0');
function timeValues() {
  const out = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) out.push(`${pad2(h)}:${pad2(m)}`);
  return out;
}

// Same 15-120 clamp MachinePanel applied, kept because the number pad is
// deliberately unclamped and a typed 5 would mean the machine sleeps while you
// are still grinding.
function saveSleepTimeout(v) {
  savePresenceSetting('sleepTimeoutMinutes', Math.max(15, Math.min(120, Number(v))));
}
async function editSleepTimeout() {
  const v = await openNumberPad({ title: t('machineSettings.autoSleepTimeout'), unit: 'min', value: presenceSettings.sleepTimeoutMinutes ?? 30 });
  if (v != null) saveSleepTimeout(v);
}

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
</script>

<template>
  <div class="swidget">
    <span class="sw-title">{{ t('settingsPage.energy') }}</span>

    <!-- The cool-down time sits IN the auto-sleep row, between its name and
         its switch, rather than on a slider row of its own: it is one number
         that changes rarely, and a row per setting is what made this a page in
         the first place. Typed, not dragged. -->
    <div class="sw-row">
      <span class="sw-name">{{ t('machineSettings.autoSleep') }}</span>
      <button class="sr-value as-val" @click="editSleepTimeout">
        {{ presenceSettings.sleepTimeoutMinutes ?? 30 }} min<span class="sr-chev">›</span>
      </button>
      <button
        class="switch"
        :class="{ on: presenceSettings.userPresenceEnabled }"
        role="switch"
        :aria-checked="!!presenceSettings.userPresenceEnabled"
        @click="savePresenceSetting('userPresenceEnabled', !presenceSettings.userPresenceEnabled)"
      ></button>
    </div>

    <div class="sw-row">
      <span class="sw-name">{{ t('scheduleSettings.title') }}</span>
      <button
        class="switch"
        :class="{ on: scheduleState.enabled }"
        role="switch"
        :aria-checked="scheduleState.enabled"
        @click="applySchedule({ enabled: !scheduleState.enabled })"
      ></button>
    </div>
    <!-- Shown whether or not the schedule is on: a card that grows and shrinks
         as you flip its switch moves everything under it, and the times are
         worth reading even while the plan is paused.

         Set in a quieter type than "Power schedule" and hairline-free, because
         these three are that switch's details, not three more settings beside
         it — and both times fit one row, since each is a label and a clock. -->
    <div class="sw-row sw-sub">
      <button class="sw-time" @click="editScheduleTime('onHour', 'onMinute', t('scheduleSettings.wake'))">
        {{ t('scheduleSettings.wake') }}<b>{{ pad2(scheduleState.onHour) }}:{{ pad2(scheduleState.onMinute) }}</b><span class="sr-chev">›</span>
      </button>
      <button class="sw-time" @click="editScheduleTime('offHour', 'offMinute', t('scheduleSettings.sleep'))">
        {{ t('scheduleSettings.sleep') }}<b>{{ pad2(scheduleState.offHour) }}:{{ pad2(scheduleState.offMinute) }}</b><span class="sr-chev">›</span>
      </button>
    </div>
    <div class="sw-row sw-sub">
      <span class="sw-subname">{{ t('scheduleSettings.days') }}</span>
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
  </div>
</template>
