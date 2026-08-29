<script setup>
/**
 * A vertical fill slider driven by pointer events, not <input type="range">:
 * the vertical range variants (`appearance: slider-vertical`, `writing-mode:
 * vertical-lr`) are respectively deprecated and Chromium-120+ only — not a bet
 * worth making on the DE1 tablet's WebView.
 */
import { computed, ref } from 'vue';

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  // One value increment. The fill floor sits one step below `min` so the lowest
  // selectable value still reads as a sliver of fill rather than an empty track.
  step: { type: Number, default: 1 },
  // Overrides the readout text; when null, the value is shown as a percentage.
  display: { type: String, default: null },
  // How many equal divisions the tick scale is drawn in (0 = no scale). A
  // plain coloured column tells you "fairly full" but not HOW full without
  // reading the number — the ticks are what make the fill legible as a
  // quantity at a glance, which is the whole reason a slider beats a field.
  ticks: { type: Number, default: 4 },
});
const emit = defineEmits(['update:modelValue']);

const track = ref(null);
const dragging = ref(false);

const pct = computed(() => {
  const floor = props.min - props.step;
  const span = props.max - floor;
  return span <= 0 ? 0 : ((props.modelValue - floor) / span) * 100;
});

function valueFromEvent(evt) {
  const rect = track.value.getBoundingClientRect();
  const ratio = 1 - Math.min(1, Math.max(0, (evt.clientY - rect.top) / rect.height));
  return Math.round(props.min + ratio * (props.max - props.min));
}

function onPointerDown(evt) {
  dragging.value = true;
  track.value.setPointerCapture(evt.pointerId);
  emit('update:modelValue', valueFromEvent(evt));
}
function onPointerMove(evt) {
  if (!dragging.value) return;
  emit('update:modelValue', valueFromEvent(evt));
}
function onPointerUp(evt) {
  dragging.value = false;
  track.value.releasePointerCapture(evt.pointerId);
}
</script>

<template>
  <div
    ref="track"
    class="vslider"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <div class="vslider-fill" :style="{ height: pct + '%' }"></div>
    <!-- Drawn OVER the fill, not under it: a scale that disappears as the
         slider fills is no scale. The lines are white at low alpha, so they
         read as a lightening on the dark track and on the accent alike. -->
    <div
      v-if="ticks > 0"
      class="vslider-ticks"
      :style="{ backgroundSize: `100% ${100 / ticks}%` }"
    ></div>
    <span class="vslider-label">{{ display ?? Math.round(modelValue) + '%' }}</span>
  </div>
</template>
