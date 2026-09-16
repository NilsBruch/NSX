<script setup>
/**
 * Skin-local settings — all Nova-namespace KV, no gateway/DE1 risk (except
 * wakelock, a display-service call). Brightness itself now lives on the
 * Settings landing page's vertical slider, not here — see SettingsView.vue.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openChooser, openConfirm, openNumberPad } from '../../composables/useModals.js';
import { TABS } from '../../router/index.js';
import {
  skinSettings, saveSkinSetting, displaySupport,
  installedSkins, activeSkinId, loadInstalledSkins, switchSkin,
} from '../../composables/useSettings.js';
import { showToast } from '../../composables/useToast.js';

const emit = defineEmits(['close']);
const { t } = useI18n();

onMounted(loadInstalledSkins);

// 'main' | 'skins' — the installed skins live one level deeper (drill in from a
// row, same as the Machine page's calibration groups), so this page keeps its
// length as skins are installed instead of growing a row per skin.
const view = ref('main');
const viewTitle = () => (view.value === 'skins' ? t('skinSettings.activeSkin') : t('settingsPage.skin'));
function goBack() { if (view.value === 'main') emit('close'); else view.value = 'main'; }

const activeSkinName = () => {
  const skin = installedSkins.value.find((x) => x.id === activeSkinId.value);
  return skin?.name || skin?.id || '—';
};

// The three token blocks in app.css, in the order the segmented control shows
// them. 'midnight' is a second DARK palette (navy-tinted, raised cards), so it
// sits next to 'dark' rather than opposite the light one.
const THEMES = [
  ['light', 'skinSettings.themeLight'],
  ['dark', 'skinSettings.themeDark'],
  ['midnight', 'skinSettings.themeMidnight'],
];

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

// Celsius or Fahrenheit, everywhere — readouts and the pickers that set them
// alike (see useUnits.js). The machine is unaffected: it is told Celsius either
// way, so this can be flipped mid-session without touching a single value.
const tempUnitOpts = [['C', t('skinSettings.tempC')], ['F', t('skinSettings.tempF')]];
async function pickTempUnit() {
  const v = await openChooser({ title: t('skinSettings.tempUnit'), options: tempUnitOpts, current: skinSettings.tempUnit });
  if (v != null) saveSkinSetting('tempUnit', v);
}

// Whole-skin zoom, applied to the root font size every rem in app.css is built
// on — so the controls grow with the type rather than the text outgrowing its
// buttons. Percentages, because that is what the setting means.
const uiScaleOpts = [[85, '85%'], [100, '100%'], [115, '115%'], [130, '130%']];
async function pickUiScale() {
  const v = await openChooser({
    title: t('skinSettings.uiScale'),
    options: uiScaleOpts.map(([value, label]) => [String(value), label]),
    current: String(skinSettings.uiScale),
  });
  if (v != null) saveSkinSetting('uiScale', Number(v));
}

/* ── Which skin the machine serves ───────────────────────────────────────────
 * The way out of Nova. Confirmed first, because it replaces the screen the user
 * is looking at with a different program — and it is not something you undo
 * from here afterwards; you would have to find the same setting in whatever
 * skin you landed in.
 */
const switching = ref(false);
async function pickSkin(skin) {
  if (switching.value || skin.id === activeSkinId.value) return;
  const ok = await openConfirm({
    title: t('skinSettings.switchSkin', { name: skin.name || skin.id }),
    message: t('skinSettings.switchSkinSub'),
  });
  if (!ok) return;
  switching.value = true;
  try {
    // Only reached when the new port never came up: the gateway HAS switched,
    // so the honest report is "it's done, go to it yourself", not an error.
    if (!(await switchSkin(skin.id))) showToast(t('skinSettings.switchSkinManual'), { position: 'top' });
  } catch (err) {
    showToast(err?.message || String(err), { position: 'top' });
  } finally {
    switching.value = false;
  }
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="goBack">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ viewTitle() }}</span>
    </div>

    <div class="settings-scroll">
      <template v-if="view === 'main'">
      <span class="setting-group-label">{{ t('skinSettings.ui') }}</span>
      <!-- A segmented control rather than a switch: the themes are named
           states, and a switch would force one of them to be the unlabelled
           "off" — you'd have to know which. Same control the Diary uses for
           Browse/History/Recipes, in its compact three-up size. -->
      <div class="setting-row">
        <span class="sr-name">{{ t('skinSettings.theme') }}</span>
        <div class="seg seg-setting seg-3" :data-pos="THEMES.findIndex(([name]) => name === skinSettings.theme)">
          <span class="seg-thumb"></span>
          <button
            v-for="[name, label] in THEMES"
            :key="name"
            :class="{ on: skinSettings.theme === name }"
            @click="saveSkinSetting('theme', name)"
          >{{ t(label) }}</button>
        </div>
      </div>
      <!-- Normal is the strip chart the skin was designed around; Expert is the
           same data as a read-it-properly plot (axes, temperature scale, a
           legend that toggles each line). Applies to the live shot and every
           history graph at once — see ShotStripChart.vue. -->
      <div class="setting-row">
        <span class="sr-main">
          <span class="sr-name">{{ t('skinSettings.graphMode') }}</span>
          <span class="sr-sub">{{ t('skinSettings.graphModeSub') }}</span>
        </span>
        <div class="seg seg-setting" :data-pos="skinSettings.graphMode === 'expert' ? 1 : 0">
          <span class="seg-thumb"></span>
          <button :class="{ on: skinSettings.graphMode !== 'expert' }" @click="saveSkinSetting('graphMode', 'normal')">{{ t('skinSettings.graphNormal') }}</button>
          <button :class="{ on: skinSettings.graphMode === 'expert' }" @click="saveSkinSetting('graphMode', 'expert')">{{ t('skinSettings.graphExpert') }}</button>
        </div>
      </div>
      <!-- Display only: the tags stay on the recipes and keep being recorded on
           every shot either way, so turning this back on shows what was saved
           while it was off. -->
      <div class="setting-row">
        <span class="sr-main">
          <span class="sr-name">{{ t('skinSettings.showTags') }}</span>
          <span class="sr-sub">{{ t('skinSettings.showTagsSub') }}</span>
        </span>
        <button class="switch" :class="{ on: skinSettings.showTags }" role="switch" :aria-checked="skinSettings.showTags" @click="saveSkinSetting('showTags', !skinSettings.showTags)"></button>
      </div>
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
      <!-- Swaps the coffee page's single-recipe dial layout for a browser:
           recipe cards on the left, the selected one's shot graph on the
           right, a shot stepper + Edit Recipe at the bottom. -->
      <div class="setting-row">
        <span class="sr-main">
          <span class="sr-name">{{ t('skinSettings.coffeeGraph') }}</span>
          <span class="sr-sub">{{ t('skinSettings.coffeeGraphSub') }}</span>
        </span>
        <button class="switch" :class="{ on: skinSettings.coffeeGraph }" role="switch" :aria-checked="skinSettings.coffeeGraph" @click="saveSkinSetting('coffeeGraph', !skinSettings.coffeeGraph)"></button>
      </div>

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
      <button class="setting-row as-btn" @click="pickStartTab">
        <span class="sr-name">{{ t('skinSettings.startPage') }}</span>
        <span class="sr-value">{{ optLabel(startTabOpts, skinSettings.startTab) }}<span class="sr-chev">›</span></span>
      </button>
      <div v-if="displaySupport.wakeLock" class="setting-row">
        <span class="sr-name">{{ t('skinSettings.wakelock') }}</span>
        <button class="switch" :class="{ on: skinSettings.wakelock }" role="switch" :aria-checked="skinSettings.wakelock" @click="saveSkinSetting('wakelock', !skinSettings.wakelock)"></button>
      </div>
      <!-- The graph's dashed pressure curve and outlined flow bars are the
           PROFILE's targets; this hides them, leaving only what the machine
           actually did. Applies to the live graph and the history one alike —
           they are the same renderer. -->
      <div class="setting-row">
        <span class="sr-main">
          <span class="sr-name">{{ t('skinSettings.showTargets') }}</span>
          <span class="sr-sub">{{ t('skinSettings.showTargetsSub') }}</span>
        </span>
        <button class="switch" :class="{ on: skinSettings.showTargets }" role="switch" :aria-checked="skinSettings.showTargets" @click="saveSkinSetting('showTargets', !skinSettings.showTargets)"></button>
      </div>
      <button class="setting-row as-btn" @click="pickReviewAutoClose">
        <span class="sr-main"><span class="sr-name">{{ t('skinSettings.reviewAutoClose') }}</span><span class="sr-sub">{{ t('skinSettings.reviewAutoCloseSub') }}</span></span>
        <span class="sr-value">{{ autoCloseLabel(skinSettings.shotReviewAutoCloseSec) }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="pickTempUnit">
        <span class="sr-main"><span class="sr-name">{{ t('skinSettings.tempUnit') }}</span><span class="sr-sub">{{ t('skinSettings.tempUnitSub') }}</span></span>
        <span class="sr-value">{{ optLabel(tempUnitOpts, skinSettings.tempUnit) }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="pickUiScale">
        <span class="sr-main"><span class="sr-name">{{ t('skinSettings.uiScale') }}</span><span class="sr-sub">{{ t('skinSettings.uiScaleSub') }}</span></span>
        <span class="sr-value">{{ skinSettings.uiScale }}%<span class="sr-chev">›</span></span>
      </button>

      <!-- Last on the page on purpose: it is the one setting here that leaves
           Nova, so it should not sit among the ones that adjust it. Only shown
           when the gateway lists more than this skin — with nothing to switch
           to, it would be a dead row. -->
      <button v-if="installedSkins.length > 1" class="setting-row as-btn" @click="view = 'skins'">
        <span class="sr-name">{{ t('skinSettings.activeSkin') }}</span>
        <span class="sr-value">{{ activeSkinName() }}<span class="sr-chev">›</span></span>
      </button>
      </template>

      <!-- One row per installed skin, a page of their own: the list grows with
           every skin installed, and the settings above it should not. -->
      <template v-else-if="view === 'skins'">
        <p class="settings-note">{{ t('skinSettings.activeSkinSub') }}</p>
        <button
          v-for="skin in installedSkins"
          :key="skin.id"
          class="setting-row as-btn"
          :disabled="switching"
          @click="pickSkin(skin)"
        >
          <span class="sr-main">
            <span class="sr-name">{{ skin.name || skin.id }}</span>
            <span class="sr-sub">{{ skin.version }}</span>
          </span>
          <span class="sr-value">
            {{ skin.id === activeSkinId ? t('skinSettings.skinActive') : '' }}
            <span v-if="skin.id !== activeSkinId" class="sr-chev">›</span>
          </span>
        </button>
      </template>
    </div>
  </div>
</template>
