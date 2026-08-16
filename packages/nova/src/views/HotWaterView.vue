<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { hotwater } from '../composables/useMachineFunctions.js';
import { openNumberPad } from '../composables/useModals.js';
import { useDragDial, DIAL_PX_PER_STEP } from '../composables/useDragDial.js';

const { t } = useI18n();
const { NSXCore } = window;

// klein/mittel/gross (Little/Medium/Large) mapped to positions 1/2/3 — the
// real hotwater presets, not invented slots.
const PRESET_KEYS = ['klein', 'mittel', 'gross'];

async function editTemp() {
  const v = await openNumberPad({ title: t('hotwater.temperature'), unit: '°C', value: String(hotwater.temp) });
  if (v == null) return;
  NSXCore.setHotwaterTemp(parseFloat(v));
}

// Press-and-pull-to-adjust, no visible track — see useDragDial.js. A plain tap
// still opens the number pad (editTemp), guarded so a drag doesn't also pop it
// open on release. Range/step matches NSX's own temperature picker (50-100°C).
//
// NSXCore.setHotwaterTemp() both updates AND pushes to the gateway in one call
// (debounced ~1s internally) — calling it live on every pointermove would still
// risk a push firing mid-drag on any brief pause, so a local override drives
// the on-screen number while dragging, and the real setter (which pushes) only
// runs once, on release.
const dragTempOverride = ref(null);
const tempDisplay = () => dragTempOverride.value ?? hotwater.temp;
const tempDrag = useDragDial({
  get: tempDisplay,
  set: (v) => { dragTempOverride.value = v; },
  onCommit: (v) => { NSXCore.setHotwaterTemp(v); dragTempOverride.value = null; },
  min: 50, max: 100, step: 1, pxPerUnit: DIAL_PX_PER_STEP / 1,
});
const onTempClick = tempDrag.guardClick(editTemp);

async function editVolume() {
  const v = await openNumberPad({ title: t('hotwater.volume'), unit: 'ml', value: String(hotwater.volume) });
  if (v == null) return;
  NSXCore.setHotwaterVolume(parseFloat(v));
}

const dragVolumeOverride = ref(null);
const volumeDisplay = () => dragVolumeOverride.value ?? hotwater.volume;
const volumeDrag = useDragDial({
  get: volumeDisplay,
  set: (v) => { dragVolumeOverride.value = v; },
  onCommit: (v) => { NSXCore.setHotwaterVolume(v); dragVolumeOverride.value = null; },
  min: 10, max: 500, step: 5, pxPerUnit: DIAL_PX_PER_STEP / 5,
});
const onVolumeClick = volumeDrag.guardClick(editVolume);

// Short tap loads a preset; holding (~600ms) saves the current temp+volume into it.
const holdTimers = {};
function onPresetDown(key) {
  holdTimers[key] = {
    held: false,
    timer: setTimeout(() => {
      holdTimers[key].held = true;
      const next = { ...hotwater.presets, [key]: { ...hotwater.presets[key], temp: hotwater.temp, volume: hotwater.volume } };
      NSXCore.setHotwaterPresets(next);
      NSXCore.selectHotwaterPreset(key);
    }, 600),
  };
}
function onPresetUp(key) {
  const h = holdTimers[key];
  if (!h) return;
  clearTimeout(h.timer);
  if (!h.held) NSXCore.selectHotwaterPreset(key);
  delete holdTimers[key];
}
function onPresetCancel(key) {
  if (holdTimers[key]) { clearTimeout(holdTimers[key].timer); delete holdTimers[key]; }
}
</script>

<template>
  <section class="page">
    <div class="page-title">{{ t('tab.hotwater') }}</div>
    <div class="dials">
      <div class="dial-group">
        <span class="dial-label">{{ t('hotwater.temperature') }}</span>
        <button
          class="dial big"
          :class="{ dragging: tempDrag.dragging.value }"
          @click="onTempClick"
          @pointerdown="tempDrag.onPointerDown"
          @pointermove="tempDrag.onPointerMove"
          @pointerup="tempDrag.onPointerUp"
        >
          <span class="num">{{ dragTempOverride ?? hotwater.temp }}</span><span class="unit">°C</span>
        </button>
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('hotwater.presets') }}</span>
        <div class="preset-stack">
          <button
            v-for="(key, i) in PRESET_KEYS"
            :key="key"
            class="preset"
            :class="{ selected: hotwater.active === key }"
            @pointerdown="onPresetDown(key)"
            @pointerup="onPresetUp(key)"
            @pointerleave="onPresetCancel(key)"
          >
            {{ i + 1 }}
          </button>
        </div>
        <span class="preset-hint">{{ t('hotwater.holdToSave') }}</span>
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('hotwater.volume') }}</span>
        <button
          class="dial big"
          :class="{ dragging: volumeDrag.dragging.value }"
          @click="onVolumeClick"
          @pointerdown="volumeDrag.onPointerDown"
          @pointermove="volumeDrag.onPointerMove"
          @pointerup="volumeDrag.onPointerUp"
        >
          <span class="num">{{ dragVolumeOverride ?? hotwater.volume }}</span><span class="unit">ml</span>
        </button>
      </div>
    </div>

    <!-- Empty, same height as Cleaning's button row (.prep-bottom) — this page
         has no bottom buttons, but without reserving the same space here,
         .dials (flex:1, vertically centred) fills more of the page and its
         orbs end up sitting lower than Cleaning's identical-looking ones. -->
    <div class="prep-bottom"></div>
  </section>
</template>
