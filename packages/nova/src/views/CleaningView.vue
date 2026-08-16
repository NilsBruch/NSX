<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { flush } from '../composables/useMachineFunctions.js';
import { openNumberPad } from '../composables/useModals.js';
import { useDragDial, DIAL_PX_PER_STEP } from '../composables/useDragDial.js';
import VerticalSlider from '../components/VerticalSlider.vue';
import CleaningAssistant from '../components/CleaningAssistant.vue';

const { t } = useI18n();
const { NSXCore } = window;

// Rinse flow (ml/s), a continuous quantity -> vertical slider, mirroring Steam
// intensity. The flush domain clamps flow to 1..10.
const flowLabel = computed(() => `${flush.flow} ml/s`);
function onFlowSlide(v) { NSXCore.setFlushFlow(v); }

// Rinse time (seconds) as a drag-to-adjust orb, same pattern as Hot Water's
// dials: a local override drives the on-screen number while dragging so the
// pushing setter (setFlushDuration) only fires once, on release.
const dragTimeOverride = ref(null);
const timeDrag = useDragDial({
  get: () => dragTimeOverride.value ?? flush.duration,
  set: (v) => { dragTimeOverride.value = v; },
  onCommit: (v) => { NSXCore.setFlushDuration(v); dragTimeOverride.value = null; },
  min: 1, max: 60, step: 1, pxPerUnit: DIAL_PX_PER_STEP / 1,
});
async function editTime() {
  if (!flush.timerEnabled) return; // ∞ while the timer is off — nothing to edit
  const v = await openNumberPad({ title: t('cleaning.time'), unit: 'sec', value: String(flush.duration) });
  if (v == null) return;
  NSXCore.setFlushDuration(parseFloat(v));
}
const onTimeClick = timeDrag.guardClick(editTime);
// Timer off = rinse until manually stopped (duration 0), same as the steam page.
function toggleTimer() { NSXCore.setFlushTimerEnabled(!flush.timerEnabled); }

// Three save-slots like Hot Water: tap loads the stored flow+time, hold
// (~600ms) overwrites it with the current pair. A flush preset legitimately
// carries both flow and duration, so selectFlushPreset (which loads both and
// sets the active highlight) is the right call here.
const LEVEL_KEYS = ['kurz', 'normal', 'lang'];
const holdTimers = {};
function onPresetDown(key) {
  holdTimers[key] = {
    held: false,
    timer: setTimeout(() => {
      holdTimers[key].held = true;
      NSXCore.setFlushPresets({ ...flush.presets, [key]: { ...flush.presets[key], flow: flush.flow, duration: flush.duration } });
      NSXCore.selectFlushPreset(key);
    }, 600),
  };
}
function onPresetUp(key) {
  const h = holdTimers[key];
  if (!h) return;
  clearTimeout(h.timer);
  if (!h.held) NSXCore.selectFlushPreset(key);
  delete holdTimers[key];
}
function onPresetCancel(key) {
  if (holdTimers[key]) { clearTimeout(holdTimers[key].timer); delete holdTimers[key]; }
}

const assistantMode = ref(null); // null | 'forwardFlush' | 'backflush' | 'descale' | 'transport'
</script>

<template>
  <section class="page">
    <div class="page-title">{{ t('tab.cleaning') }}</div>
    <div class="dials">
      <div class="dial-group">
        <span class="dial-label">{{ t('cleaning.flow') }}</span>
        <VerticalSlider
          class="flow-slider"
          :model-value="flush.flow"
          :min="1"
          :max="10"
          :display="flowLabel"
          @update:model-value="onFlowSlide"
        />
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('cleaning.presets') }}</span>
        <div class="preset-stack">
          <button
            v-for="(key, i) in LEVEL_KEYS"
            :key="key"
            class="preset"
            :class="{ selected: flush.active === key }"
            @pointerdown="onPresetDown(key)"
            @pointerup="onPresetUp(key)"
            @pointerleave="onPresetCancel(key)"
          >{{ i + 1 }}</button>
        </div>
        <span class="preset-hint">{{ t('cleaning.holdToSave') }}</span>
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('cleaning.time') }}</span>
        <button
          class="timer-pod"
          :class="{ off: !flush.timerEnabled, dragging: timeDrag.dragging.value }"
          @click="onTimeClick"
          @pointerdown="flush.timerEnabled && timeDrag.onPointerDown($event)"
          @pointermove="timeDrag.onPointerMove"
          @pointerup="timeDrag.onPointerUp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
          <template v-if="flush.timerEnabled">
            <span class="num">{{ dragTimeOverride ?? flush.duration }}</span><span class="unit">sec</span>
          </template>
          <span v-else class="num">∞</span>
        </button>
        <button
          class="switch"
          :class="{ on: flush.timerEnabled }"
          role="switch"
          :aria-checked="flush.timerEnabled"
          :aria-label="t('cleaning.time')"
          style="margin-top: 14px"
          @click="toggleTimer"
        ></button>
      </div>
    </div>
    <div class="prep-bottom cleaning-actions" style="justify-content: center; gap: 24px">
      <button class="btn" @click="assistantMode = 'forwardFlush'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12a8 8 0 0 1 14-5m2-3v5h-5" /><path d="M20 12a8 8 0 0 1-14 5m-2 3v-5h5" />
        </svg>
        {{ t('cleaning.forwardFlush') }}
      </button>
      <button class="btn" @click="assistantMode = 'backflush'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12a8 8 0 0 1 14-5m2-3v5h-5" /><path d="M20 12a8 8 0 0 1-14 5m-2 3v-5h5" />
        </svg>
        {{ t('cleaning.backflush') }}
      </button>
      <button class="btn" @click="assistantMode = 'descale'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5s5.5 6.3 5.5 10a5.5 5.5 0 0 1-11 0c0-3.7 5.5-10 5.5-10z" /><path d="M8 13l8-.01M10 16l4-.01" />
        </svg>
        {{ t('cleaning.descale') }}
      </button>
      <!-- Transport = air purge (drain), guided by the same assistant. -->
      <button class="btn" @click="assistantMode = 'transport'">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h11v9H3z" /><path d="M14 9h3.5L21 12.5V15h-7z" /><circle cx="7.5" cy="17.5" r="1.6" /><circle cx="16.5" cy="17.5" r="1.6" />
        </svg>
        {{ t('cleaning.transport') }}
      </button>
    </div>

    <CleaningAssistant v-if="assistantMode" :mode="assistantMode" @close="assistantMode = null" />
  </section>
</template>
