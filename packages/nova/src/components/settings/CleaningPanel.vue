<script setup>
/**
 * Cleaning, for the phone. The tablet has it as a whole tab (CleaningView) —
 * a vertical flow slider, a drag-to-adjust time orb and three preset pods —
 * which is a layout that needs a tablet. The phone gets the same capabilities
 * in the settings-row idiom every other panel in here uses: the rinse's flow
 * and time as rows that open a number pad, the three save-slots, and the four
 * guided routines.
 *
 * Not a re-implementation of any of it: flow/time/timer go through the same
 * NSXCore flush setters, the save-slots through the same useFlushPresets, and
 * the routines open the very same CleaningAssistant the tablet opens. Only
 * the controls differ, because a 68px orb you drag is not a phone control.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { flush } from '../../composables/useMachineFunctions.js';
import { useFlushPresets, FLUSH_PRESET_KEYS } from '../../composables/useFlushPresets.js';
import { openNumberPad } from '../../composables/useModals.js';
import CleaningAssistant from '../CleaningAssistant.vue';

defineEmits(['close']);
const { t } = useI18n();
const { NSXCore } = window;

const { onPresetDown, onPresetUp, onPresetCancel } = useFlushPresets(flush);

// The flush domain clamps flow to 1..10 ml/s and duration to 1..60 s; the pad
// is given the same bounds so a typo is caught before it reaches the machine.
async function editFlow() {
  const v = await openNumberPad({ title: t('cleaning.flow'), unit: 'ml/s', value: String(flush.flow), min: 1, max: 10 });
  if (v != null) NSXCore.setFlushFlow(parseFloat(v));
}
async function editTime() {
  if (!flush.timerEnabled) return; // ∞ while the timer is off — nothing to edit
  const v = await openNumberPad({ title: t('cleaning.time'), unit: 'sec', value: String(flush.duration), min: 1, max: 60 });
  if (v != null) NSXCore.setFlushDuration(parseFloat(v));
}
// Timer off = rinse until manually stopped (duration 0), same as the steam page.
function toggleTimer() { NSXCore.setFlushTimerEnabled(!flush.timerEnabled); }

const timeLabel = computed(() => (flush.timerEnabled ? `${flush.duration} sec` : '∞'));

// null | 'forwardFlush' | 'backflush' | 'descale' | 'transport'
const assistantMode = ref(null);
const ROUTINES = ['forwardFlush', 'backflush', 'descale', 'transport'];
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ t('tab.cleaning') }}</span>
    </div>

    <div class="settings-scroll">
      <span class="setting-group-label">{{ t('cleaning.rinse') }}</span>
      <button class="setting-row as-btn" @click="editFlow">
        <span class="sr-name">{{ t('cleaning.flow') }}</span>
        <span class="sr-value">{{ flush.flow }} ml/s<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" :disabled="!flush.timerEnabled" @click="editTime">
        <span class="sr-name">{{ t('cleaning.time') }}</span>
        <span class="sr-value" :class="{ muted: !flush.timerEnabled }">{{ timeLabel }}<span class="sr-chev">›</span></span>
      </button>
      <!-- Off means rinse until you stop it (the row above reads ∞ and stops
           being editable), which is why this is a switch and not part of the
           duration itself. -->
      <div class="setting-row">
        <span class="sr-name">{{ t('cleaning.timer') }}</span>
        <button
          class="switch" :class="{ on: flush.timerEnabled }" role="switch"
          :aria-checked="flush.timerEnabled" :aria-label="t('cleaning.timer')"
          @click="toggleTimer"
        ></button>
      </div>

      <span class="setting-group-label">{{ t('cleaning.presets') }}</span>
      <!-- Same tap-loads / hold-saves pods as the tablet, laid out as a row of
           three inside one card instead of a vertical stack beside a dial. -->
      <div class="setting-row clean-presets">
        <button
          v-for="(key, i) in FLUSH_PRESET_KEYS"
          :key="key"
          class="preset"
          :class="{ selected: flush.active === key }"
          @pointerdown="onPresetDown(key)"
          @pointerup="onPresetUp(key)"
          @pointerleave="onPresetCancel(key)"
        >{{ i + 1 }}</button>
      </div>
      <p class="eq-hint">{{ t('cleaning.holdToSave') }}</p>

      <span class="setting-group-label">{{ t('tab.cleaning') }}</span>
      <button
        v-for="mode in ROUTINES" :key="mode"
        class="setting-row as-btn" @click="assistantMode = mode"
      >
        <span class="sr-name">{{ t(`cleaning.${mode}`) }}</span>
        <span class="sr-chev">›</span>
      </button>
    </div>

    <PageTransition>
      <CleaningAssistant v-if="assistantMode" :mode="assistantMode" @close="assistantMode = null" />
    </PageTransition>
  </div>
</template>
