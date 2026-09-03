<script setup>
/**
 * Screen brightness — one value: a title, a percentage and a full-width track.
 * The label sits at one end of the header line and the percentage at the
 * other, which leaves the whole row below for the bar: the usual
 * label/track/value row spent about half its width on two words and a number
 * that the header already had room for.
 *
 * Rendered only where the gateway's host can actually dim the screen (core's
 * display domain, from GET /api/v1/display's platformSupported) — the guard
 * lives in SettingsView, where the card is placed.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { displayBrightness, setBrightness } from '../../composables/useSettings.js';
import SettingSlider from './SettingSlider.vue';

const { t } = useI18n();

// The value under the finger, so the header's readout tracks the bar instead
// of jumping only once the drag is released. Null when not dragging.
const dragging = ref(null);
const shown = computed(() => dragging.value ?? displayBrightness.value);

function commit(v) {
  dragging.value = null;
  setBrightness(v);
}
</script>

<template>
  <div class="swidget">
    <div class="sw-head">
      <span class="sw-title">{{ t('settingsPage.display') }}</span>
      <span class="sw-title sw-readout">{{ shown }} %</span>
    </div>
    <SettingSlider
      class="sw-slider"
      bare
      :label="t('settingsPage.display')"
      :model-value="displayBrightness"
      :min="10" :max="100" :step="10"
      @preview="dragging = $event" @change="commit"
    />
  </div>
</template>
