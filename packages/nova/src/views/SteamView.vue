<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { steam } from '../composables/useMachineFunctions.js';
import { openNumberPad } from '../composables/useModals.js';
import { useDragDial, DIAL_PX_PER_STEP } from '../composables/useDragDial.js';
import VerticalSlider from '../components/VerticalSlider.vue';

const { t } = useI18n();
const { NSXCore } = window;

// Intensity IS the steam flow rate (ml/s) — a continuous quantity, so it's a
// slider rather than fixed buttons. The DE1's usable steam range for milk is
// ~0.6 (gentle) to 1.5 (aggressive); the slider works in tenths (6..15) so
// each step is a clean 0.1 ml/s and never a rounding artefact.
const FLOW_MIN = 6;
const FLOW_MAX = 15;
const flowScaled = computed(() => Math.round((steam.flow || 0) * 10));
const flowLabel = computed(() => `${(steam.flow || 0).toFixed(1)} ml/s`);
// setSteamFlow is debounced + clamps to 0.1 internally, so live slide is fine.
function onFlowSlide(v) { NSXCore.setSteamFlow(v / 10); }

// Three save-slots, exactly like the Hot Water page: tap loads the stored
// intensity + timer, hold (~600ms) overwrites both with the current ones —
// the Steam page's own two adjustable dials, same as Hot Water saves its
// temp+volume and Cleaning saves its flow+duration. selectSteamPreset (core)
// also carries the preset's temp, but that's not independently dialed here;
// it just re-pushes whatever the preset already had.
const LEVEL_KEYS = ['schwach', 'normal', 'stark'];

const holdTimers = {};
function onPresetDown(key) {
  holdTimers[key] = {
    held: false,
    timer: setTimeout(() => {
      holdTimers[key].held = true;
      const next = { ...steam.presets, [key]: { ...steam.presets[key], flow: steam.flow, duration: steam.duration } };
      NSXCore.setSteamPresets(next);
      NSXCore.selectSteamPreset(key);
    }, 600),
  };
}
function onPresetUp(key) {
  const h = holdTimers[key];
  if (!h) return;
  clearTimeout(h.timer);
  if (!h.held) NSXCore.selectSteamPreset(key);
  delete holdTimers[key];
}
function onPresetCancel(key) {
  if (holdTimers[key]) { clearTimeout(holdTimers[key].timer); delete holdTimers[key]; }
}

async function editDuration() {
  if (!steam.timerEnabled) return; // no duration to edit while the timer is off (∞)
  const v = await openNumberPad({ title: t('steam.timer'), unit: 'sec', value: String(steam.duration) });
  if (v == null) return;
  NSXCore.setSteamDuration(parseFloat(v));
}

// NSXCore.setSteamDuration() both updates AND pushes (debounced ~1s
// internally) in one call — a local override drives the live number during
// the drag so the real setter only fires once, on release. See the identical
// note in HotWaterView.vue.
const dragDurationOverride = ref(null);
const durationDrag = useDragDial({
  get: () => dragDurationOverride.value ?? steam.duration,
  set: (v) => { dragDurationOverride.value = v; },
  onCommit: (v) => { NSXCore.setSteamDuration(v); dragDurationOverride.value = null; },
  // 90s max mirrors core's STEAM_SAFETY_MAX (clampDuration) — the wand never
  // steams longer, so dialing past it would only clamp on commit anyway.
  min: 1, max: 90, step: 1, pxPerUnit: DIAL_PX_PER_STEP / 1,
});
const onDurationClick = durationDrag.guardClick(editDuration);

// Two independent switches: the master steam power (off = no steam at all,
// temp/flow 0) and the auto-stop timer (off = steam runs until you release the
// lever, i.e. duration 0 — temp/flow untouched).
function toggleEnabled() { NSXCore.setSteamEnabled(!steam.enabled); }
function toggleTimer() { NSXCore.setSteamTimerEnabled(!steam.timerEnabled); }
</script>

<template>
  <section class="page">
    <div class="page-title">{{ t('tab.steam') }}</div>

    <div class="dials" :class="{ disabled: !steam.enabled }">
      <div class="dial-group">
        <span class="dial-label">{{ t('steam.intensity') }}</span>
        <VerticalSlider
          class="flow-slider"
          :model-value="flowScaled"
          :min="FLOW_MIN"
          :max="FLOW_MAX"
          :display="flowLabel"
          @update:model-value="onFlowSlide"
        />
      </div>
      <div class="dial-group">
        <span class="dial-label">{{ t('steam.presets') }}</span>
        <div class="preset-stack">
          <button
            v-for="(key, i) in LEVEL_KEYS"
            :key="key"
            class="preset"
            :class="{ selected: steam.active === key }"
            @pointerdown="onPresetDown(key)"
            @pointerup="onPresetUp(key)"
            @pointerleave="onPresetCancel(key)"
          >{{ i + 1 }}</button>
        </div>
        <span class="preset-hint">{{ t('steam.holdToSave') }}</span>
      </div>
      <div class="dial-group">
        <span class="dial-label">{{ t('steam.timer') }}</span>
        <button
          class="timer-pod"
          :class="{ off: !steam.timerEnabled, dragging: durationDrag.dragging.value }"
          @click="onDurationClick"
          @pointerdown="steam.timerEnabled && durationDrag.onPointerDown($event)"
          @pointermove="durationDrag.onPointerMove"
          @pointerup="durationDrag.onPointerUp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
          <template v-if="steam.timerEnabled">
            <span class="num">{{ dragDurationOverride ?? steam.duration }}</span><span class="unit">sec</span>
          </template>
          <span v-else class="num">∞</span>
        </button>
        <button
          class="switch"
          :class="{ on: steam.timerEnabled }"
          role="switch"
          :aria-checked="steam.timerEnabled"
          :aria-label="t('steam.timer')"
          style="margin-top: 14px"
          @click="toggleTimer"
        ></button>
      </div>
    </div>

    <!-- Same height as Cleaning's button row (.prep-bottom) — without
         reserving that space, .dials (flex:1, vertically centred) filled more
         of the page and its orbs sat lower than Cleaning's. Now the home for
         the master steam power switch (off dims/locks the dials above),
         previously a page-level row above the dials. -->
    <div class="prep-bottom steam-actions" style="justify-content: center; gap: 40px">
      <div class="steam-power">
        <span class="vl">{{ t('steam.enabled') }}</span>
        <button
          class="switch"
          :class="{ on: steam.enabled }"
          role="switch"
          :aria-checked="steam.enabled"
          :aria-label="t('steam.enabled')"
          @click="toggleEnabled"
        ></button>
      </div>
    </div>
  </section>
</template>
