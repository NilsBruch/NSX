<script setup>
/**
 * A shot as a thumbnail: pressure, flow and weight-flow as three thin curves,
 * no axes, no labels, no interaction. For list rows — the readable-at-a-glance
 * SHAPE of an extraction (did it ramp, did it spike, did it hold), not a chart
 * you read values off. ShotStripChart.vue remains the real one.
 *
 * Deliberately not ShotStripChart at small size: that renderer's language is
 * half-second flow BARS, which at ~50px wide collapse into a smear. Curves
 * survive the shrink; bars don't.
 *
 * SVG rather than its canvas, because at this size the whole point is crisp
 * hairlines at any DPR, there is nothing to animate, and a list of twenty is
 * twenty elements the browser can paint rather than twenty canvases to script.
 *
 * `spark` is core's buildShotSparkline output: three arrays already normalised
 * 0..1 on the shared 0-12 scale, so every thumbnail in a list is on the same
 * axis and two of them can be compared by eye.
 */
import { computed } from 'vue';

const props = defineProps({
  // { pressure: number[], flow: number[], weightFlow: number[] } | null
  spark: { type: Object, default: null },
});

// A 100x100 viewBox stretched by preserveAspectRatio="none" — the box's real
// aspect lives in CSS, so the card can change the thumbnail's proportions
// without this component knowing.
const VB = 100;

/** 0..1 values -> an SVG points list, first sample at x=0, last at x=100. */
function toPoints(values) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const step = VB / (values.length - 1);
  return values
    // y is flipped: SVG's origin is top-left, the plot's is bottom-left.
    .map((v, i) => `${(i * step).toFixed(2)},${((1 - v) * VB).toFixed(2)}`)
    .join(' ');
}

const pressure = computed(() => toPoints(props.spark?.pressure));
const flow = computed(() => toPoints(props.spark?.flow));
const weightFlow = computed(() => toPoints(props.spark?.weightFlow));
</script>

<template>
  <!-- No placeholder box when there is nothing to draw: the metrics for a row
       arrive asynchronously (useDiary's shotMetrics queue), and an empty frame
       that later fills would make the whole list twitch as it loads. The card
       reserves the space instead, so nothing moves. -->
  <svg
    v-if="pressure"
    class="shot-spark"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <!-- Painted in the same order and colours as ShotStripChart, so a shot
         looks like itself in both places: weight-flow behind, then flow, then
         pressure on top as the curve the eye should land on. -->
    <polyline class="sp-weight" :points="weightFlow" />
    <polyline class="sp-flow" :points="flow" />
    <polyline class="sp-pressure" :points="pressure" />
  </svg>
</template>
