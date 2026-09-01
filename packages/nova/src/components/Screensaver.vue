<script setup>
/**
 * The lock face — shown by App.vue whenever `locked` is true (see
 * useScreensaver.js). Ported to Nova from NSX's screensaver: a full-bleed photo
 * that crossfades through a set, a clock/date overlay, and — by default — a
 * swipe-to-unlock slider. The slider is not decoration: a lock face that a
 * tap dismisses is one that a cloth wiping the screen dismisses too, which is
 * why tapping stopped unlocking in the first place. The "tap to wake" skin
 * setting turns it back into a single tap for people who would rather have
 * the convenience; it is opt-in for that reason.
 *
 * Even then it listens for a CLICK, not a pointerdown: a click requires press
 * and release on the same element without much travel, so a finger dragged
 * across the glass still doesn't wake it.
 *
 * Whether unlocking also wakes the DE1 depends on the separate "wake DE1 on
 * unlock" skin setting.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { unlock } from '../composables/useScreensaver.js';
import { skinSettings } from '../composables/useSettings.js';
import { formatClock } from '../utils/clock.js';

const { t } = useI18n();

// Imported (not served from public/) and forced inline as base64 data URIs
// via the `?inline` query — same reasoning as viteSingleFile bundling JS/CSS
// into index.html: the Decent app loads Nova's single index.html by
// injecting its HTML directly rather than navigating to it as a served file,
// which breaks ANY relative resource reference. A runtime `public/screensaver/
// *.jpg` path (Nova's previous approach) 404s there even though the exact
// same relative-path pattern works fine for NSX, which IS served as a real
// folder — see the design log. Inlining removes the dependency on a base URL
// existing at all. Index.html grows by ~5MB (the photos' base64 size) for it.
import s1 from '../assets/screensaver/Screen_saver_Decent_1.jpg?inline';
import s2 from '../assets/screensaver/Screen_saver_Decent_2.jpg?inline';
import s3 from '../assets/screensaver/Screen_saver_Decent_3.jpg?inline';
import s4 from '../assets/screensaver/Screen_saver_Decent_4.jpg?inline';
import s5 from '../assets/screensaver/Screen_saver_Decent_5.jpg?inline';
import s6 from '../assets/screensaver/Screen_saver_Decent_6.jpg?inline';
import s7 from '../assets/screensaver/Screen_saver_Decent_7.jpg?inline';
import s8 from '../assets/screensaver/Screen_saver_Decent_8.jpg?inline';
import s10 from '../assets/screensaver/Screen_saver_Decent_10.jpg?inline';
import s12 from '../assets/screensaver/Screen_saver_Decent_12.jpg?inline';
import s13 from '../assets/screensaver/Screen_saver_Decent_13.jpg?inline';
import s14 from '../assets/screensaver/Screen_saver_Decent_14.jpg?inline';
import s15 from '../assets/screensaver/Screen_saver_Decent_15.jpg?inline';

const IMAGES = [s1, s2, s3, s4, s5, s6, s7, s8, s10, s12, s13, s14, s15];
const CROSSFADE_MS = 8000;

// Two stacked layers crossfaded by opacity: the visible one holds the current
// image, the hidden one is preloaded with the next, then they swap.
let idx = Math.floor(Math.random() * IMAGES.length);
const layerA = ref(IMAGES[idx]);
const layerB = ref('');
const aVisible = ref(true);
let imgTimer = null;
function advance() {
  idx = (idx + 1) % IMAGES.length;
  const next = IMAGES[idx];
  if (aVisible.value) layerB.value = next;
  else layerA.value = next;
  aVisible.value = !aVisible.value;
}

// ── Clock ──
const now = ref(new Date());
let clockTimer = null;

onMounted(() => {
  clockTimer = setInterval(() => { now.value = new Date(); }, 15_000);
  imgTimer = setInterval(advance, CROSSFADE_MS);
});
onUnmounted(() => { clearInterval(clockTimer); clearInterval(imgTimer); });

const clockLabel = computed(() => formatClock(now.value));
const dateLabel = computed(() =>
  now.value.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
);

// ── Swipe to unlock ──
const track = ref(null);
const thumbX = ref(0);
const maxX = ref(0);
const THUMB = 52;
const dragging = ref(false);
let startX = 0;
let startPos = 0;

// Label fades out as the thumb travels; fill grows behind it.
const fillWidth = computed(() => `${6 + thumbX.value + THUMB}px`);
const labelOpacity = computed(() => (maxX.value > 0 ? Math.max(0, 1 - (thumbX.value / maxX.value) * 1.8) : 1));

function onDown(evt) {
  const el = track.value;
  if (!el) return;
  maxX.value = el.clientWidth - THUMB - 12;
  dragging.value = true;
  startX = evt.clientX;
  startPos = thumbX.value;
  evt.currentTarget.setPointerCapture?.(evt.pointerId);
}
function onMove(evt) {
  if (!dragging.value) return;
  const dx = startPos + (evt.clientX - startX);
  thumbX.value = Math.max(0, Math.min(maxX.value, dx));
}
function onUp() {
  if (!dragging.value) return;
  dragging.value = false;
  const pct = maxX.value > 0 ? thumbX.value / maxX.value : 0;
  if (pct >= 0.82) unlock();
  thumbX.value = 0; // snap back (unlock unmounts this anyway on success)
}
</script>

<template>
  <div class="screensaver" @click="skinSettings.tapToUnlock ? unlock() : null">
    <div class="ss-bg" :style="{ backgroundImage: `url(${layerA})`, opacity: aVisible ? 1 : 0 }"></div>
    <div class="ss-bg" :style="{ backgroundImage: layerB ? `url(${layerB})` : 'none', opacity: aVisible ? 0 : 1 }"></div>
    <div class="ss-gradient"></div>

    <div class="ss-content">
      <div class="ss-time-wrap">
        <div class="ss-time">{{ clockLabel }}</div>
        <div class="ss-date">{{ dateLabel }}</div>
      </div>

      <div v-if="skinSettings.tapToUnlock" class="ss-tap-hint">{{ t('status.tapHint') }}</div>

      <div v-else class="ss-slide-bar">
        <div
          ref="track"
          class="ss-slide-track"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <div class="ss-slide-fill" :style="{ width: fillWidth, transition: dragging ? 'none' : 'width 0.25s ease' }"></div>
          <span class="ss-slide-label" :style="{ opacity: labelOpacity }">{{ t('status.sleepHint') }}</span>
          <div
            class="ss-slide-thumb"
            :style="{ transform: `translateX(${thumbX}px)`, transition: dragging ? 'none' : 'transform 0.25s ease' }"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screensaver {
  position: fixed; inset: 0; z-index: 50; overflow: hidden;
  background: #07090c; touch-action: none; user-select: none; -webkit-user-select: none;
}
.ss-bg {
  position: absolute; inset: 0;
  background-size: cover; background-position: center;
  transition: opacity 0.7s ease; will-change: opacity;
}
.ss-gradient {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.65) 100%);
}
.ss-content {
  position: relative; height: 100%;
  display: flex; flex-direction: column; justify-content: space-between; align-items: center;
  padding-top: max(env(safe-area-inset-top, 0px), 52px);
  padding-bottom: max(env(safe-area-inset-bottom, 0px), 36px);
  pointer-events: none;
}
.ss-time-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.ss-time {
  font-size: clamp(80px, 24vw, 120px); font-weight: 100; color: #fff; letter-spacing: -3px;
  line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 0 2px 24px rgba(0,0,0,0.35);
}
.ss-date {
  font-size: 18px; font-weight: 400; color: rgba(255,255,255,0.88);
  letter-spacing: 0.02em; text-shadow: 0 1px 10px rgba(0,0,0,0.45); text-transform: capitalize;
}
/* Takes the slider's place, so the clock above it doesn't shift between the
   two modes. No surface of its own — there is nothing to aim at, the whole
   screen is the target. */
.ss-tap-hint {
  height: 64px; display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-sm); font-weight: 600; letter-spacing: 0.16em;
  text-transform: uppercase; color: rgba(255, 255, 255, 0.8);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}
.ss-slide-bar { width: 100%; max-width: 340px; padding: 0 4px; pointer-events: auto; }
.ss-slide-track {
  position: relative; height: 64px;
  background: rgba(255,255,255,0.18); border-radius: 32px; border: 0.5px solid rgba(255,255,255,0.28);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  overflow: hidden; display: flex; align-items: center; justify-content: center;
}
.ss-slide-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: rgba(255,255,255,0.28); border-radius: 32px; pointer-events: none;
}
.ss-slide-label {
  position: relative; z-index: 1;
  font-size: 16px; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase;
  pointer-events: none; user-select: none; color: rgba(255,255,255,0.85);
  animation: ss-label-glow 2.8s ease-in-out infinite; will-change: filter;
}
@keyframes ss-label-glow {
  0%   { filter: brightness(0.85); text-shadow: 0 0 8px rgba(255,255,255,0.3); }
  50%  { filter: brightness(1.15); text-shadow: 0 0 20px rgba(255,255,255,0.7); }
  100% { filter: brightness(0.85); text-shadow: 0 0 8px rgba(255,255,255,0.3); }
}
.ss-slide-thumb {
  position: absolute; left: 6px; top: 6px; bottom: 6px; aspect-ratio: 1;
  background: #fff; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; z-index: 2;
  box-shadow: 0 2px 12px rgba(0,0,0,0.35); touch-action: none; color: #555;
}
.ss-slide-thumb svg { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
</style>
