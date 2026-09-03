<script setup>
/**
 * Phone "Machine" — the DE1's own state, plus the steam / hot water / rinse
 * parameters the tablet spreads across three separate rails (SteamView,
 * HotWaterView, CleaningView). One page instead of three tabs: these are
 * settings you dial in occasionally, not screens you live on the way the
 * Espresso page is, so the phone doesn't need a tab each for them.
 *
 * Every write below is a PARAMETER, never a dispense command — selecting a
 * preset or dragging a slider changes what the machine would do the next
 * time it steams/pours/rinses, exactly like editing a recipe's dose changes
 * what the next shot pulls. None of it can start one. The one thing this
 * page deliberately does NOT carry over from CleaningView is its four
 * assistant buttons (forward flush / backflush / descale / transport) —
 * CleaningAssistant.vue is the one component in this skin that can actually
 * start a dispense, and it stays off the phone entirely; see App.vue's
 * comment on the live overlays for the fuller invariant.
 *
 * Sliders reuse settings/SettingSlider.vue, not VerticalSlider — the latter
 * is sized for the tablet's dial layout and this page is plain settings
 * rows, the same shape MachinePanel/SkinPanel/AppPanel already use on both
 * layouts. Preset hold-to-save is copied verbatim (same 600ms, same shape)
 * from Steam/HotWater/CleaningView's own onPresetDown/Up/Cancel — three
 * near-identical copies, same as the tablet has, rather than a shared
 * composable extracted for exactly three call sites.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine } from '../../../composables/useCore.js';
import { steam, hotwater, flush } from '../../../composables/useMachineFunctions.js';
import { skinSettings } from '../../../composables/useSettings.js';
import { formatWaterLevel } from '../../../utils/water.js';
import { showToast } from '../../../composables/useToast.js';
import { openNumberPad } from '../../../composables/useModals.js';
import SettingSlider from '../../settings/SettingSlider.vue';

const { t } = useI18n();
const { NSXApi, NSXCore } = window;

const statusLabel = computed(() => {
  if (!machine.connected) return t('status.noMachine');
  const key = machine.state === 'idle' ? 'ready' : machine.state;
  return t(`status.${key}`);
});
const waterLabel = computed(() => formatWaterLevel(machine.water.currentLevel, skinSettings.waterUnit));

const machineOn = computed(() => machine.state !== 'sleeping');
const machineBusy = ref(false);
async function toggleMachine() {
  if (machineBusy.value) return;
  machineBusy.value = true;
  try {
    await NSXApi.setMachineState(machineOn.value ? 'sleeping' : 'idle');
  } catch (err) {
    showToast(t('toast.controlFailed') + ': ' + err.message);
  } finally {
    machineBusy.value = false;
  }
}

// ── Steam ────────────────────────────────────────────────────────────────
function toggleSteamEnabled() { NSXCore.setSteamEnabled(!steam.enabled); }
function toggleSteamTimer() { NSXCore.setSteamTimerEnabled(!steam.timerEnabled); }
async function editSteamIntensity() {
  const v = await openNumberPad({ title: t('steam.intensity'), unit: 'ml/s', value: steam.flow.toFixed(1) });
  if (v != null) NSXCore.setSteamFlow(parseFloat(v));
}
async function editSteamDuration() {
  const v = await openNumberPad({ title: t('steam.duration'), unit: 'sec', value: String(steam.duration) });
  if (v != null) NSXCore.setSteamDuration(parseFloat(v));
}
// Tap loads a preset; holding (~600ms) overwrites it with the current
// intensity + duration. Verbatim from SteamView.vue's own onPresetDown/Up/
// Cancel — same 600ms, same shape, three times over (see the file header).
const STEAM_PRESETS = ['schwach', 'normal', 'stark'];
const steamHold = {};
function steamPresetDown(key) {
  steamHold[key] = {
    held: false,
    timer: setTimeout(() => {
      steamHold[key].held = true;
      NSXCore.setSteamPresets({ ...steam.presets, [key]: { ...steam.presets[key], flow: steam.flow, duration: steam.duration } });
      NSXCore.selectSteamPreset(key);
    }, 600),
  };
}
function steamPresetUp(key) {
  const h = steamHold[key];
  if (!h) return;
  clearTimeout(h.timer);
  if (!h.held) NSXCore.selectSteamPreset(key);
  delete steamHold[key];
}
function steamPresetCancel(key) {
  if (steamHold[key]) { clearTimeout(steamHold[key].timer); delete steamHold[key]; }
}

// ── Hot water ────────────────────────────────────────────────────────────
async function editHotwaterTemp() {
  const v = await openNumberPad({ title: t('hotwater.temperature'), unit: '°C', value: String(hotwater.temp) });
  if (v != null) NSXCore.setHotwaterTemp(parseFloat(v));
}
async function editHotwaterVolume() {
  const v = await openNumberPad({ title: t('hotwater.volume'), unit: 'ml', value: String(hotwater.volume) });
  if (v != null) NSXCore.setHotwaterVolume(parseFloat(v));
}
const HOTWATER_PRESETS = ['klein', 'mittel', 'gross'];
const hotwaterHold = {};
function hotwaterPresetDown(key) {
  hotwaterHold[key] = {
    held: false,
    timer: setTimeout(() => {
      hotwaterHold[key].held = true;
      NSXCore.setHotwaterPresets({ ...hotwater.presets, [key]: { ...hotwater.presets[key], temp: hotwater.temp, volume: hotwater.volume } });
      NSXCore.selectHotwaterPreset(key);
    }, 600),
  };
}
function hotwaterPresetUp(key) {
  const h = hotwaterHold[key];
  if (!h) return;
  clearTimeout(h.timer);
  if (!h.held) NSXCore.selectHotwaterPreset(key);
  delete hotwaterHold[key];
}
function hotwaterPresetCancel(key) {
  if (hotwaterHold[key]) { clearTimeout(hotwaterHold[key].timer); delete hotwaterHold[key]; }
}

// ── Rinse / flush ────────────────────────────────────────────────────────
function toggleFlushTimer() { NSXCore.setFlushTimerEnabled(!flush.timerEnabled); }
async function editFlushFlow() {
  const v = await openNumberPad({ title: t('cleaning.flow'), unit: 'ml/s', value: String(flush.flow) });
  if (v != null) NSXCore.setFlushFlow(parseFloat(v));
}
async function editFlushDuration() {
  const v = await openNumberPad({ title: t('cleaning.time'), unit: 'sec', value: String(flush.duration) });
  if (v != null) NSXCore.setFlushDuration(parseFloat(v));
}
const FLUSH_PRESETS = ['kurz', 'normal', 'lang'];
const flushHold = {};
function flushPresetDown(key) {
  flushHold[key] = {
    held: false,
    timer: setTimeout(() => {
      flushHold[key].held = true;
      NSXCore.setFlushPresets({ ...flush.presets, [key]: { ...flush.presets[key], flow: flush.flow, duration: flush.duration } });
      NSXCore.selectFlushPreset(key);
    }, 600),
  };
}
function flushPresetUp(key) {
  const h = flushHold[key];
  if (!h) return;
  clearTimeout(h.timer);
  if (!h.held) NSXCore.selectFlushPreset(key);
  delete flushHold[key];
}
function flushPresetCancel(key) {
  if (flushHold[key]) { clearTimeout(flushHold[key].timer); delete flushHold[key]; }
}
</script>

<template>
  <section class="phone-page">
    <h1 class="phone-title">{{ t('phone.machine') }}</h1>

    <div class="phone-card">
      <div class="phone-status-row">
        <span class="phone-status-dot" :class="{ on: machine.connected && machine.state !== 'sleeping' }"></span>
        <span class="phone-status-label">{{ statusLabel }}</span>
        <button
          class="switch phone-machine-switch"
          :class="{ on: machineOn }"
          role="switch"
          :aria-checked="machineOn"
          :disabled="machineBusy || !machine.connected"
          @click="toggleMachine"
        ></button>
      </div>
      <div v-if="machine.water.currentLevel != null" class="phone-status-sub">{{ t('machineSettings.waterTank') }}: {{ waterLabel }}</div>
    </div>

    <span class="setting-group-label">{{ t('tab.steam') }}</span>
    <div class="setting-row">
      <span class="sr-name">{{ t('steam.enabled') }}</span>
      <button class="switch" :class="{ on: steam.enabled }" role="switch" :aria-checked="steam.enabled" @click="toggleSteamEnabled"></button>
    </div>
    <SettingSlider
      :label="t('steam.intensity')" :model-value="steam.flow"
      :min="0.6" :max="1.5" :step="0.1" :decimals="1" unit=" ml/s"
      @change="NSXCore.setSteamFlow($event)" @edit="editSteamIntensity"
    />
    <div class="setting-row">
      <span class="sr-name">{{ t('steam.timer') }}</span>
      <button class="switch" :class="{ on: steam.timerEnabled }" role="switch" :aria-checked="steam.timerEnabled" @click="toggleSteamTimer"></button>
    </div>
    <SettingSlider
      v-if="steam.timerEnabled"
      :label="t('steam.duration')" :model-value="steam.duration"
      :min="1" :max="90" :step="1" unit=" sec"
      @change="NSXCore.setSteamDuration($event)" @edit="editSteamDuration"
    />
    <div class="setting-row">
      <span class="sr-main">
        <span class="sr-name">{{ t('steam.presets') }}</span>
        <span class="sr-sub">{{ t('steam.holdToSave') }}</span>
      </span>
      <div class="phone-preset-row">
        <button
          v-for="(key, i) in STEAM_PRESETS" :key="key"
          class="phone-preset" :class="{ selected: steam.active === key }"
          @pointerdown="steamPresetDown(key)" @pointerup="steamPresetUp(key)" @pointerleave="steamPresetCancel(key)"
        >{{ i + 1 }}</button>
      </div>
    </div>

    <span class="setting-group-label">{{ t('tab.hotwater') }}</span>
    <SettingSlider
      :label="t('hotwater.temperature')" :model-value="hotwater.temp"
      :min="50" :max="100" :step="1" unit="°C"
      @change="NSXCore.setHotwaterTemp($event)" @edit="editHotwaterTemp"
    />
    <SettingSlider
      :label="t('hotwater.volume')" :model-value="hotwater.volume"
      :min="10" :max="500" :step="5" unit=" ml"
      @change="NSXCore.setHotwaterVolume($event)" @edit="editHotwaterVolume"
    />
    <div class="setting-row">
      <span class="sr-main">
        <span class="sr-name">{{ t('hotwater.presets') }}</span>
        <span class="sr-sub">{{ t('hotwater.holdToSave') }}</span>
      </span>
      <div class="phone-preset-row">
        <button
          v-for="(key, i) in HOTWATER_PRESETS" :key="key"
          class="phone-preset" :class="{ selected: hotwater.active === key }"
          @pointerdown="hotwaterPresetDown(key)" @pointerup="hotwaterPresetUp(key)" @pointerleave="hotwaterPresetCancel(key)"
        >{{ i + 1 }}</button>
      </div>
    </div>

    <span class="setting-group-label">{{ t('cleaning.rinse') }}</span>
    <SettingSlider
      :label="t('cleaning.flow')" :model-value="flush.flow"
      :min="1" :max="10" :step="1" unit=" ml/s"
      @change="NSXCore.setFlushFlow($event)" @edit="editFlushFlow"
    />
    <div class="setting-row">
      <span class="sr-name">{{ t('steam.timer') }}</span>
      <button class="switch" :class="{ on: flush.timerEnabled }" role="switch" :aria-checked="flush.timerEnabled" @click="toggleFlushTimer"></button>
    </div>
    <SettingSlider
      v-if="flush.timerEnabled"
      :label="t('cleaning.time')" :model-value="flush.duration"
      :min="1" :max="60" :step="1" unit=" sec"
      @change="NSXCore.setFlushDuration($event)" @edit="editFlushDuration"
    />
    <div class="setting-row">
      <span class="sr-main">
        <span class="sr-name">{{ t('cleaning.presets') }}</span>
        <span class="sr-sub">{{ t('cleaning.holdToSave') }}</span>
      </span>
      <div class="phone-preset-row">
        <button
          v-for="(key, i) in FLUSH_PRESETS" :key="key"
          class="phone-preset" :class="{ selected: flush.active === key }"
          @pointerdown="flushPresetDown(key)" @pointerup="flushPresetUp(key)" @pointerleave="flushPresetCancel(key)"
        >{{ i + 1 }}</button>
      </div>
    </div>
  </section>
</template>
