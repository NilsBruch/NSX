<script setup>
/**
 * The lock face — shown by App.vue whenever `locked` is true (see
 * useScreensaver.js): a clock/date over a flat dark field and — by default —
 * a swipe-to-unlock slider. The slider is not decoration: a lock face that a
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

/* No background photos.
 *
 * There were 13, imported with `?inline` so Vite base64'd them into
 * index.html — the Decent app injects Nova's HTML rather than serving it, so
 * a relative `public/screensaver/*.jpg` path 404s there and inlining was the
 * only thing that worked. The cost is that every byte lands in index.html and
 * the WebView parses ALL of it at app start, minutes before the lock face is
 * ever shown, on a tablet that can't afford it. Even at q75/1280x800 that was
 * ~2MB of base64 on every boot for something most people see as a clock.
 *
 * Removed rather than made optional: a skin setting would still have shipped
 * the bytes. Bringing them back means solving the delivery problem first
 * (served files with a working base URL, or fetched on first idle rather than
 * parsed at boot) — `git revert` restores the photos, the crossfade and the
 * gradient that made text readable over them.
 */

// ── Clock ──
const now = ref(new Date());
let clockTimer = null;

onMounted(() => {
  clockTimer = setInterval(() => { now.value = new Date(); }, 15_000);
});
onUnmounted(() => clearInterval(clockTimer));

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
