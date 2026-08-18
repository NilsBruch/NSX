<script setup>
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { openTextField, openNumberPad } from '../../composables/useModals.js';
import {
  visualizerSettings, visualizerPasswordSet, loadVisualizerSettings, saveVisualizerSetting,
  visualizerPlugin, setPluginEnabled,
} from '../../composables/useSettings.js';

defineEmits(['close']);
const { t } = useI18n();

onMounted(loadVisualizerSettings);

function toggleEnabled() {
  const plugin = visualizerPlugin();
  if (plugin) setPluginEnabled(plugin.id, !plugin.loaded);
}
async function editUser() {
  const v = await openTextField({ title: t('systemSettings.vizUser'), value: visualizerSettings.username });
  if (v != null) saveVisualizerSetting('username', v);
}
// Always opens EMPTY: the gateway redacts the stored password, so there is
// nothing to pre-fill. That makes an empty confirm ambiguous, so it's treated
// as "leave the saved one alone" rather than saving a blank — otherwise
// opening this row and confirming would silently wipe a working login.
async function editPass() {
  const v = await openTextField({ title: t('systemSettings.vizPass'), value: '' });
  if (v) saveVisualizerSetting('password', v);
}
async function editMinShot() {
  const v = await openNumberPad({ title: t('systemSettings.vizMinShot'), unit: 's', value: visualizerSettings.minShotDuration });
  if (v != null) saveVisualizerSetting('minShotDuration', Number(v));
}
async function editBackSyncInterval() {
  const v = await openNumberPad({ title: t('systemSettings.vizBackSyncInterval'), unit: 's', value: visualizerSettings.backSyncIntervalSeconds });
  if (v != null) saveVisualizerSetting('backSyncIntervalSeconds', Math.max(60, Math.min(3600, Number(v))));
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('systemSettings.integrations') }}
      </button>
      <span class="ov-title">{{ t('systemSettings.visualizer') }}</span>
    </div>

    <div class="settings-scroll">
      <div class="setting-row">
        <span class="sr-name">{{ t('systemSettings.vizEnabled') }}</span>
        <button class="switch" :class="{ on: visualizerPlugin()?.loaded }" role="switch" :aria-checked="!!visualizerPlugin()?.loaded" @click="toggleEnabled"></button>
      </div>
      <button class="setting-row as-btn" @click="editUser">
        <span class="sr-name">{{ t('systemSettings.vizUser') }}</span>
        <span class="sr-value" :class="{ muted: !visualizerSettings.username }">{{ visualizerSettings.username || t('systemSettings.notSet') }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="editPass">
        <span class="sr-name">{{ t('systemSettings.vizPass') }}</span>
        <span class="sr-value" :class="{ muted: !visualizerPasswordSet }">{{ visualizerPasswordSet ? t('systemSettings.vizPassSaved') : t('systemSettings.notSet') }}<span class="sr-chev">›</span></span>
      </button>
      <div class="setting-row">
        <span class="sr-name">{{ t('systemSettings.vizAutoUpload') }}</span>
        <button class="switch" :class="{ on: visualizerSettings.autoUpload }" role="switch" :aria-checked="visualizerSettings.autoUpload" @click="saveVisualizerSetting('autoUpload', !visualizerSettings.autoUpload)"></button>
      </div>
      <button class="setting-row as-btn" @click="editMinShot">
        <span class="sr-name">{{ t('systemSettings.vizMinShot') }}</span>
        <span class="sr-value">{{ visualizerSettings.minShotDuration }} s<span class="sr-chev">›</span></span>
      </button>
      <div class="setting-row">
        <span class="sr-name">{{ t('systemSettings.vizBackSync') }}</span>
        <button class="switch" :class="{ on: visualizerSettings.backSync }" role="switch" :aria-checked="visualizerSettings.backSync" @click="saveVisualizerSetting('backSync', !visualizerSettings.backSync)"></button>
      </div>
      <button v-if="visualizerSettings.backSync" class="setting-row as-btn" @click="editBackSyncInterval">
        <span class="sr-name">{{ t('systemSettings.vizBackSyncInterval') }}</span>
        <span class="sr-value">{{ visualizerSettings.backSyncIntervalSeconds }} s<span class="sr-chev">›</span></span>
      </button>
    </div>
  </div>
</template>
