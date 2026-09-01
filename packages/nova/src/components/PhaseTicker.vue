<script setup>
/**
 * The profile's phases as a ticker: the frame the machine is running now,
 * highlighted and centred, with the one before and the one after faded either
 * side. When the machine moves on, the whole row slides over by one phase — so
 * the step you were watching visibly becomes "what just happened" instead of
 * being replaced in place. That movement IS the information; without it a
 * phase change is a silent text swap you miss while looking at the graph.
 *
 * Presentational only: the caller resolves the names and the live index (see
 * LiveShotOverlay), this just draws and moves them.
 *
 * Each name sits in its own chip, borrowing the recipe crumbs' vocabulary
 * (outlined = not where you are, filled + accent border = where you are), and
 * each chip is as wide as its NAME — a fixed slot width would ellipsis away
 * exactly the words that make a phase recognisable. The cost is that the
 * offset can no longer be arithmetic: with unequal widths, centring the
 * current chip means measuring where it actually sits.
 *
 * Which is also why the current chip is not set in a larger type size, only a
 * different fill: growing the text would change the row's widths over the same
 * 420ms as the slide, and the two would fight — the measurement is taken from
 * a layout that is still moving. Same size everywhere, so the geometry is
 * settled the moment the phase changes and the slide is the only motion.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

const props = defineProps({
  names: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
});

// Off-the-end frames (a number the profile has no entry for) would translate
// the track into empty space; clamp so the centred chip is always a real name.
const pos = computed(() => Math.max(0, Math.min(props.names.length - 1, props.index)));

const win = ref(null);
const track = ref(null);
const offset = ref(0);

/** Puts the middle of the current chip on the middle of the window. offsetLeft
 *  is read against the track (which is `position: relative` for exactly this
 *  reason), so it stays a track-local coordinate whatever the page layout
 *  around the ticker does. */
function recenter() {
  const w = win.value;
  const slot = track.value?.children?.[pos.value];
  if (!w || !slot) return;
  offset.value = w.clientWidth / 2 - (slot.offsetLeft + slot.offsetWidth / 2);
}

// nextTick, not immediate: the chips have to exist (and, on a name change, be
// re-laid-out) before their widths mean anything.
watch([pos, () => props.names], () => nextTick(recenter), { immediate: true });
onMounted(recenter);
</script>

<template>
  <div v-if="names.length" ref="win" class="phase-ticker">
    <div ref="track" class="pt-track" :style="{ transform: `translateX(${offset}px)` }">
      <span v-for="(name, i) in names" :key="i" class="pt-chip" :class="{ on: i === pos }">{{ name }}</span>
    </div>
  </div>
</template>
