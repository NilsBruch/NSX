<script setup>
/**
 * A 0–5 star rating in half-star steps. Read-only for display (recipe cards,
 * the Espresso title row) or interactive (the rating modal): each star has two
 * tap zones — its left half sets x.5, its right half sets x.0.
 */
import { computed } from 'vue';

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  readonly: { type: Boolean, default: false },
  size: { type: Number, default: 26 },
  // One star plus the number ("4.5") instead of five stars — for tight rows
  // where five stars would crowd out the text beside them.
  compact: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const STAR = 'M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z';

// Fill for star n (1..5): 100% when the value covers it, 50% for a half.
const fillPct = (n) => {
  const v = Number(props.modelValue) || 0;
  if (v >= n) return 100;
  if (v >= n - 0.5) return 50;
  return 0;
};
function set(v) { if (!props.readonly) emit('update:modelValue', v); }

const pxSize = computed(() => `${props.size}px`);
// 4 -> "4", 4.5 -> "4.5": the trailing .0 is noise at this size.
const compactText = computed(() => {
  const v = Math.round((Number(props.modelValue) || 0) * 2) / 2;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
});
</script>

<template>
  <div v-if="compact" class="star-rating compact" :style="{ '--star-size': pxSize }">
    <svg class="star-solid" viewBox="0 0 24 24" aria-hidden="true"><path :d="STAR" /></svg>
    <span class="star-num">{{ compactText }}</span>
  </div>
  <div v-else class="star-rating" :class="{ interactive: !readonly }" :style="{ '--star-size': pxSize }">
    <span v-for="n in 5" :key="n" class="star-cell">
      <svg class="star-bg" viewBox="0 0 24 24" aria-hidden="true"><path :d="STAR" /></svg>
      <span class="star-fill" :style="{ width: fillPct(n) + '%' }">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="STAR" /></svg>
      </span>
      <template v-if="!readonly">
        <button class="star-hit left" :aria-label="`${n - 0.5}`" @click="set(n - 0.5)"></button>
        <button class="star-hit right" :aria-label="`${n}`" @click="set(n)"></button>
      </template>
    </span>
  </div>
</template>

<style scoped>
.star-rating { display: inline-flex; gap: 4px; }
.star-rating.compact { align-items: center; gap: 3px; }
.star-solid {
  width: var(--star-size); height: var(--star-size); display: block;
  fill: var(--accent); stroke: var(--accent); stroke-width: 1.4;
}
.star-num {
  font-size: calc(var(--star-size) * 0.82); font-weight: 600;
  color: var(--accent); line-height: 1; font-variant-numeric: tabular-nums;
}
.star-cell { position: relative; width: var(--star-size); height: var(--star-size); display: inline-block; }
.star-bg, .star-fill svg {
  width: var(--star-size); height: var(--star-size); display: block;
}
.star-bg { fill: none; stroke: var(--faint); stroke-width: 1.4; }
.star-fill {
  position: absolute; left: 0; top: 0; height: 100%; overflow: hidden; pointer-events: none;
}
.star-fill svg { fill: var(--accent); stroke: var(--accent); stroke-width: 1.4; }
.interactive .star-hit {
  position: absolute; top: 0; bottom: 0; width: 50%;
  background: none; border: none; padding: 0; cursor: pointer; z-index: 1;
}
.interactive .star-hit.left { left: 0; }
.interactive .star-hit.right { right: 0; }
</style>
