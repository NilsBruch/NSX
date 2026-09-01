<script setup>
/**
 * Skin-local settings — all Nova-namespace KV, no gateway/DE1 risk (except
 * wakelock, a display-service call). Brightness itself now lives on the
 * Settings landing page's vertical slider, not here — see SettingsView.vue.
 */
import { useI18n } from 'vue-i18n';
import { openChooser, openNumberPad } from '../../composables/useModals.js';
import { TABS } from '../../router/index.js';
import { skinSettings, saveSkinSetting, displaySupport } from '../../composables/useSettings.js';

defineEmits(['close']);
const { t } = useI18n();

const timeFormatOpts = [['24h', t('skinSettings.timeFormat24')], ['12h', t('skinSettings.timeFormat12')]];
const startTabOpts = TABS.map((tab) => [tab.name, t(`tab.${tab.name}`)]);
const optLabel = (opts, v) => opts.find(([value]) => value === v)?.[1] ?? '';

// Stored as a number of seconds (0 = off); the chooser works in strings.
const autoCloseOpts = [
  ['0', t('skinSettings.reviewAutoCloseOff')],
  ['3', t('skinSettings.reviewAutoCloseSec', { n: 3 })],
  ['5', t('skinSettings.reviewAutoCloseSec', { n: 5 })],
  ['10', t('skinSettings.reviewAutoCloseSec', { n: 10 })],
  ['15', t('skinSettings.reviewAutoCloseSec', { n: 15 })],
];
const autoCloseLabel = (v) => (Number(v) > 0 ? t('skinSettings.reviewAutoCloseSec', { n: Number(v) }) : t('skinSettings.reviewAutoCloseOff'));

async function pickTimeFormat() {
  const v = await openChooser({ title: t('skinSettings.timeFormat'), options: timeFormatOpts, current: skinSettings.timeFormat });
  if (v != null) saveSkinSetting('timeFormat', v);
}
async function pickStartTab() {
  const v = await openChooser({ title: t('skinSettings.startPage'), options: startTabOpts, current: skinSettings.startTab });
  if (v != null) saveSkinSetting('startTab', v);
}
async function editScreensaverBrightness() {
  // Clamped, unlike most numpad fields: this is a percentage pushed straight
  // to the display service, so anything outside 0–100 is meaningless. 0 IS
  // valid (a fully dark lockscreen) — see loadSkinSettings' note on why it
  // must not be treated as "unset".
  const v = await openNumberPad({
    title: t('skinSettings.screensaverBrightness'), unit: '%',
    value: skinSettings.screensaverBrightness, min: 0, max: 100,
  });
  if (v != null) saveSkinSetting('screensaverBrightness', Number(v));
}
async function pickReviewAutoClose() {
  const v = await openChooser({ title: t('skinSettings.reviewAutoClose'), options: autoCloseOpts, current: String(skinSettings.shotReviewAutoCloseSec) });
  if (v != null) saveSkinSetting('shotReviewAutoCloseSec', Number(v));
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ t('settingsPage.skin') }}</span>
    </div>

    <div class="settings-scroll">
      <span class="setting-group-label">{{ t('skinSettings.lockscreen') }}</span>
      <div class="setting-row">
        <span class="sr-main"><span class="sr-name">{{ t('skinSettings.wakeOnUnlock') }}</span><span class="sr-sub">{{ t('skinSettings.wakeOnUnlockSub') }}</span></span>
        <button class="switch" :class="{ on: skinSettings.wakeOnUnlock }" role="switch" :aria-checked="skinSettings.wakeOnUnlock" @click="saveSkinSetting('wakeOnUnlock', !skinSettings.wakeOnUnlock)"></button>
      </div>
      <div class="setting-row">
        <span class="sr-main">
          <span class="sr-name">{{ t('skinSettings.tapToUnlock') }}</span>
          <span class="sr-sub">{{ t('skinSettings.tapToUnlockSub') }}</span>
        </span>
        <button class="switch" :class="{ on: skinSettings.tapToUnlock }" role="switch" :aria-checked="skinSettings.tapToUnlock" @click="saveSkinSetting('tapToUnlock', !skinSettings.tapToUnlock)"></button>
      </div>
      <!-- Both hidden on a host the gateway can't drive: the dim level would
           never be applied, the wake lock never held (core's display domain). -->
      <button v-if="displaySupport.brightness" class="setting-row as-btn" @click="editScreensaverBrightness">
        <span class="sr-name">{{ t('skinSettings.screensaverBrightness') }}</span>
        <span class="sr-value">{{ skinSettings.screensaverBrightness }}%<span class="sr-chev">›</span></span>
      </button>

      <span class="setting-group-label">{{ t('skinSettings.general') }}</span>
      <button class="setting-row as-btn" @click="pickTimeFormat">
        <span class="sr-name">{{ t('skinSettings.timeFormat') }}</span>
        <span class="sr-value">{{ optLabel(timeFormatOpts, skinSettings.timeFormat) }}<span class="sr-chev">›</span></span>
      </button>
      <!-- Off restores the original look: one blue everywhere, untinted greys.
           The rail's six tab colours stay either way — this is about whether
           the PAGE takes the colour of the tab you're on. -->
      <div class="setting-row">
        <span class="sr-main">
          <span class="sr-name">{{ t('skinSettings.tabColors') }}</span>
          <span class="sr-sub">{{ t('skinSettings.tabColorsSub') }}</span>
        </span>
        <button class="switch" :class="{ on: skinSettings.tabColors }" role="switch" :aria-checked="skinSettings.tabColors" @click="saveSkinSetting('tabColors', !skinSettings.tabColors)"></button>
      </div>
      <button class="setting-row as-btn" @click="pickStartTab">
        <span class="sr-name">{{ t('skinSettings.startPage') }}</span>
        <span class="sr-value">{{ optLabel(startTabOpts, skinSettings.startTab) }}<span class="sr-chev">›</span></span>
      </button>
      <div v-if="displaySupport.wakeLock" class="setting-row">
        <span class="sr-name">{{ t('skinSettings.wakelock') }}</span>
        <button class="switch" :class="{ on: skinSettings.wakelock }" role="switch" :aria-checked="skinSettings.wakelock" @click="saveSkinSetting('wakelock', !skinSettings.wakelock)"></button>
      </div>
      <button class="setting-row as-btn" @click="pickReviewAutoClose">
        <span class="sr-main"><span class="sr-name">{{ t('skinSettings.reviewAutoClose') }}</span><span class="sr-sub">{{ t('skinSettings.reviewAutoCloseSub') }}</span></span>
        <span class="sr-value">{{ autoCloseLabel(skinSettings.shotReviewAutoCloseSec) }}<span class="sr-chev">›</span></span>
      </button>
    </div>
  </div>
</template>
