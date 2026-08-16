<script setup>
/**
 * A settings row that reads AND writes a single numeric value: drag the track
 * for a coarse adjustment (committed on release, so the gateway isn't spammed
 * per pixel), or tap the value on the right to type an exact figure via the
 * number pad. Same fill-floor trick as VerticalSlider — the lowest selectable
 * value still shows a sliver rather than an empty track.
 */
import { computed, ref } from 'vue';
import { openAlert } from '../../composables/useModals.js';

const props = defineProps({
  label: { type: String, required: true },
  // Optional explanation shown via a tap on the ⓘ next to the label — for
  // settings whose effect isn't obvious from the name alone (e.g. the DE1's
  // calibration multipliers).
  hint: { type: String, default: null },
  modelValue: { type: Number, default: null },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  decimals: { type: Number, default: 0 },
  // Appended verbatim to the readout (include a leading space if you want one).
  unit: { type: String, default: '' },
  // Overrides the numeric readout with arbitrary text (e.g. a frame's name
  // instead of its raw index) while the drag/track math still runs on
  // modelValue as usual — only the displayed string changes.
  textValue: { type: String, default: null },
  // Opt-in for the 0-means-off sliders (a step's volume/weight cap, the
  // profile's stop-at targets): what to show INSTEAD of "0" at the floor, so
  // an inactive limit reads as off rather than as a real cap of zero. Left
  // null for sliders where 0 is a genuine value (e.g. frame index 0).
  offLabel: { type: String, default: null },
});
const emit = defineEmits(['change', 'edit']);

const track = ref(null);
const dragValue = ref(null); // non-null only while a drag is in flight

const shown = computed(() => dragValue.value ?? props.modelValue);
const hasValue = computed(() => shown.value != null && !Number.isNaN(shown.value));
const pct = computed(() => {
  if (!hasValue.value) return 0;
  const floor = props.min - props.step;
  const span = props.max - floor;
  return span <= 0 ? 0 : Math.max(0, Math.min(100, ((shown.value - floor) / span) * 100));
});
// While dragging, show the live numeric value (immediate feedback on the
// index/position being dragged to) — textValue only takes over once settled,
// since it reflects the parent's last COMMITTED value, not the live drag.
const numericDisplay = computed(() => (hasValue.value ? shown.value.toFixed(props.decimals) + props.unit : '—'));
const display = computed(() => {
  // "Off" wins over everything, including mid-drag: dragging to the floor
  // should say so immediately, not read as a 0 g cap.
  if (props.offLabel != null && hasValue.value && shown.value === 0) return props.offLabel;
  return dragValue.value === null && props.textValue != null ? props.textValue : numericDisplay.value;
});

function quantize(raw) {
  const stepped = Math.round(raw / props.step) * props.step;
  return Number(Math.min(props.max, Math.max(props.min, stepped)).toFixed(6));
}
function valueFromEvent(evt) {
  const rect = track.value.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (evt.clientX - rect.left) / rect.width));
  return quantize(props.min + ratio * (props.max - props.min));
}
function onPointerDown(evt) {
  track.value.setPointerCapture(evt.pointerId);
  dragValue.value = valueFromEvent(evt);
}
function onPointerMove(evt) {
  if (dragValue.value === null) return;
  dragValue.value = valueFromEvent(evt);
}
function onPointerUp(evt) {
  if (dragValue.value === null) return;
  track.value.releasePointerCapture(evt.pointerId);
  const v = dragValue.value;
  dragValue.value = null;
  if (v !== props.modelValue) emit('change', v);
}
function showHint() {
  if (props.hint) openAlert({ title: props.label, message: props.hint });
}
</script>

<template>
  <div class="setting-row slider-row">
    <span class="sr-name">
      {{ label }}
      <button v-if="hint" type="button" class="sr-info-btn" :aria-label="`${label} info`" @click="showHint">ⓘ</button>
    </span>
    <div
      ref="track"
      class="hslider"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="hslider-fill" :style="{ width: pct + '%' }"></div>
    </div>
    <button class="sr-value as-val" @click="emit('edit')">{{ display }}<span class="sr-chev">›</span></button>
  </div>
</template>
