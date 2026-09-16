<script setup>
/**
 * Settings that belong to the Streamline-Bridge gateway, not the DE1 itself —
 * BLE devices, charging, the update checker, plugins. See MachinePanel.vue for
 * the DE1-only half of what used to be one grab-bag "Machine" tile.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openChooser, openConfirm, openTextField, openWheel } from '../../composables/useModals.js';
import {
  devices, loadDevices, forgetDevice,
  wifiScales, loadWifiScales, addWifiScale, removeWifiScale,
  appSettings, loadAppSettings, saveAppSetting,
  machineSettings, loadMachineSettings, saveMachineSetting,
  loadPlugins, plugins,
} from '../../composables/useSettings.js';
import { showToast } from '../../composables/useToast.js';
import PluginsPanel from './PluginsPanel.vue';

defineEmits(['close']);
const { t } = useI18n();

onMounted(() => {
  loadDevices();
  loadAppSettings();
  loadMachineSettings();
  loadPlugins();
  loadWifiScales();
});

/* Pairings.
 * Connecting and disconnecting is the settings page's Connection widget.
 * Forgetting belongs here with the other things you SET: it is not a session
 * action but a decision about which devices this machine keeps reaching for,
 * and it is confirmed because the only way back is to put the device in
 * pairing mode and scan for it again.
 */
async function forget(device) {
  const ok = await openConfirm({
    title: t('machineSettings.forgetDevice', { name: device.name || device.id }),
    message: t('machineSettings.forgetDeviceSub'),
    danger: true,
  });
  if (!ok) return;
  try {
    await forgetDevice(device.id);
  } catch (err) {
    showToast(err?.message || String(err));
  }
}

/* Wi-Fi scales.
 * A network scale is not discovered — it answers at an address you know — so
 * unlike everything else on this page its list is typed in rather than scanned.
 */
async function addScale() {
  const host = await openTextField({
    title: t('machineSettings.addWifiScale'),
    placeholder: t('machineSettings.wifiScaleHint'),
  });
  if (!host) return;
  try {
    await addWifiScale(host);
  } catch (err) {
    showToast(err?.message || String(err));
  }
}

async function removeScale(host) {
  const ok = await openConfirm({ title: t('machineSettings.removeWifiScale', { host }), danger: true });
  if (!ok) return;
  try {
    await removeWifiScale(host);
  } catch (err) {
    showToast(err?.message || String(err));
  }
}

// DE1 first, scale after — the machine is the primary device. Only the
// preferred-device pickers below read this now.
const deviceRank = (type) => (type === 'machine' ? 0 : type === 'scale' ? 1 : 2);
const orderedDevices = computed(() => [...devices.value].sort((a, b) => deviceRank(a.type) - deviceRank(b.type)));

// '' (not null) represents "None" — openChooser resolves null on cancel, so
// null must stay unambiguous as "the user closed this without picking anything".
const noneLabel = () => t('machineSettings.none');
const optLabel = (opts, v) => opts.find(([value]) => value === (v || ''))?.[1] ?? noneLabel();
const scalePowerOpts = [
  ['disabled', t('machineSettings.spDisabled')],
  ['displayOff', t('machineSettings.spDisplayOff')],
  ['disconnect', t('machineSettings.spDisconnect')],
];
const chargingOpts = [
  ['disabled', t('appSettings.chargingDisabled')],
  ['longevity', t('appSettings.chargingLongevity')],
  ['balanced', t('appSettings.chargingBalanced')],
  ['highAvailability', t('appSettings.chargingHighAvailability')],
];

async function pickScalePowerMode() {
  const v = await openChooser({ title: t('machineSettings.scalePower'), options: scalePowerOpts, current: appSettings.scalePowerMode });
  if (v != null) saveAppSetting('scalePowerMode', v);
}

// '' (not null) means "None" here too — same reasoning as scalePowerOpts above.
const machineOpts = computed(() => [['', noneLabel()], ...orderedDevices.value.filter((d) => d.type !== 'scale').map((d) => [d.id, d.name ?? d.id])]);
const scaleOpts = computed(() => [['', noneLabel()], ...orderedDevices.value.filter((d) => d.type === 'scale').map((d) => [d.id, d.name ?? d.id])]);
async function pickPreferredMachine() {
  const v = await openChooser({ title: t('machineSettings.preferredMachine'), options: machineOpts.value, current: appSettings.preferredMachineId || '' });
  if (v != null) saveAppSetting('preferredMachineId', v || null);
}
async function pickPreferredScale() {
  const v = await openChooser({ title: t('machineSettings.preferredScale'), options: scaleOpts.value, current: appSettings.preferredScaleId || '' });
  if (v != null) saveAppSetting('preferredScaleId', v || null);
}
async function pickChargingMode() {
  const v = await openChooser({ title: t('appSettings.chargingMode'), options: chargingOpts, current: appSettings.chargingMode });
  if (v != null) saveAppSetting('chargingMode', v);
}

// Night mode: moved here from the Schedule page, which the settings page's
// Energy widget replaced. It always belonged in this group -- it pauses the
// TABLET's charging overnight (nightMode* are appSettings keys), and never had
// anything to do with the machine's power schedule it used to sit next to.
// Stored as minutes-of-day, e.g. 1320 = 22:00.
function pad2(n) { return String(n).padStart(2, '0'); }
function timeValues() {
  const out = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) out.push(`${pad2(h)}:${pad2(m)}`);
  return out;
}
function minutesToHHMM(mins) {
  const m = ((Number(mins) || 0) % 1440 + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
async function editNightTime(key, label) {
  const v = await openWheel({ title: label, values: timeValues(), current: minutesToHHMM(appSettings[key]) });
  if (v == null) return;
  saveAppSetting(key, hhmmToMinutes(v));
}

const gmOpts = [['disabled', t('systemSettings.gmDisabled')], ['tracking', t('systemSettings.gmTracking')], ['full', t('systemSettings.gmFull')]];
const logOpts = ['INFO', 'WARNING', 'SEVERE', 'FINE', 'FINER', 'FINEST', 'ALL', 'OFF'].map((v) => [v, v]);
const optLabelSimple = (opts, v) => opts.find(([value]) => value === v)?.[1] ?? '';
async function pickGatewayMode() {
  const v = await openChooser({ title: t('systemSettings.gatewayMode'), options: gmOpts, current: appSettings.gatewayMode });
  if (v != null) saveAppSetting('gatewayMode', v);
}
async function pickLogLevel() {
  const v = await openChooser({ title: t('systemSettings.logLevel'), options: logOpts, current: appSettings.logLevel });
  if (v != null) saveAppSetting('logLevel', v);
}

const showPlugins = ref(false);
// How many there are to configure, so the row says whether it is worth the trip.
const pluginCount = computed(() => plugins.value.length);
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ t('settingsPage.app') }}</span>
    </div>

    <div class="settings-scroll">
      <!-- Connecting and disconnecting is the settings page's Connection
           widget; what stays here is what you SET rather than what you do —
           which device to reach for on startup, and what a sleeping machine
           should do to the scale. The list is still loaded, because these
           three pick from it. -->
      <span class="setting-group-label">{{ t('machineSettings.connections') }}</span>
      <button class="setting-row as-btn" @click="pickPreferredMachine">
        <span class="sr-main"><span class="sr-name">{{ t('machineSettings.preferredMachine') }}</span><span class="sr-sub">{{ t('machineSettings.autoConnect') }}</span></span>
        <span class="sr-value">{{ optLabel(machineOpts, appSettings.preferredMachineId) }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="pickPreferredScale">
        <span class="sr-main"><span class="sr-name">{{ t('machineSettings.preferredScale') }}</span><span class="sr-sub">{{ t('machineSettings.autoConnect') }}</span></span>
        <span class="sr-value">{{ optLabel(scaleOpts, appSettings.preferredScaleId) }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="pickScalePowerMode">
        <span class="sr-main"><span class="sr-name">{{ t('machineSettings.scalePower') }}</span><span class="sr-sub">{{ t('machineSettings.spSub') }}</span></span>
        <span class="sr-value">{{ optLabel(scalePowerOpts, appSettings.scalePowerMode) }}<span class="sr-chev">›</span></span>
      </button>

      <!-- Pairings and network scales: which devices this machine keeps
           reaching for, as opposed to what is connected right now. -->
      <span class="setting-group-label">{{ t('machineSettings.pairings') }}</span>
      <button v-for="d in orderedDevices" :key="d.id" class="setting-row as-btn" @click="forget(d)">
        <span class="sr-main">
          <span class="sr-name">{{ d.name || d.id }}</span>
          <span class="sr-sub">{{ t('machineSettings.forget') }}</span>
        </span>
        <span class="sr-value muted">{{ d.connected ? t('settingsPage.connected') : t('settingsPage.disconnected') }}</span>
      </button>
      <button v-for="host in wifiScales" :key="host" class="setting-row as-btn" @click="removeScale(host)">
        <span class="sr-main">
          <span class="sr-name">{{ host }}</span>
          <span class="sr-sub">{{ t('machineSettings.wifiScale') }}</span>
        </span>
        <span class="sr-value muted">{{ t('machineSettings.remove') }}</span>
      </button>
      <button class="setting-row as-btn" @click="addScale">
        <span class="sr-name">{{ t('machineSettings.addWifiScale') }}</span>
        <span class="sr-value"><span class="sr-chev">›</span></span>
      </button>

      <span class="setting-group-label">{{ t('appSettings.powerCharging') }}</span>
      <button class="setting-row as-btn" @click="pickChargingMode">
        <span class="sr-name">{{ t('appSettings.chargingMode') }}</span>
        <span class="sr-value">{{ optLabelSimple(chargingOpts, appSettings.chargingMode) }}<span class="sr-chev">›</span></span>
      </button>
      <div class="setting-row">
        <span class="sr-name">{{ t('machineSettings.usb') }}</span>
        <button class="switch" :class="{ on: machineSettings.usb }" role="switch" :aria-checked="!!machineSettings.usb" @click="saveMachineSetting('usb', !machineSettings.usb)"></button>
      </div>
      <div class="setting-row">
        <span class="sr-main"><span class="sr-name">{{ t('appSettings.lowBatteryBrightnessLimit') }}</span><span class="sr-sub">{{ t('appSettings.lowBatteryBrightnessLimitSub') }}</span></span>
        <button class="switch" :class="{ on: appSettings.lowBatteryBrightnessLimit }" role="switch" :aria-checked="!!appSettings.lowBatteryBrightnessLimit" @click="saveAppSetting('lowBatteryBrightnessLimit', !appSettings.lowBatteryBrightnessLimit)"></button>
      </div>
      <div class="setting-row">
        <span class="sr-main"><span class="sr-name">{{ t('scheduleSettings.nightModeEnabled') }}</span><span class="sr-sub">{{ t('scheduleSettings.nightModeSub') }}</span></span>
        <button class="switch" :class="{ on: appSettings.nightModeEnabled }" role="switch" :aria-checked="!!appSettings.nightModeEnabled" @click="saveAppSetting('nightModeEnabled', !appSettings.nightModeEnabled)"></button>
      </div>
      <template v-if="appSettings.nightModeEnabled">
        <button class="setting-row as-btn" @click="editNightTime('nightModeSleepTime', t('scheduleSettings.nightSleep'))">
          <span class="sr-name">{{ t('scheduleSettings.nightSleep') }}</span>
          <span class="sr-value">{{ minutesToHHMM(appSettings.nightModeSleepTime) }}<span class="sr-chev">›</span></span>
        </button>
        <button class="setting-row as-btn" @click="editNightTime('nightModeMorningTime', t('scheduleSettings.nightWake'))">
          <span class="sr-name">{{ t('scheduleSettings.nightWake') }}</span>
          <span class="sr-value">{{ minutesToHHMM(appSettings.nightModeMorningTime) }}<span class="sr-chev">›</span></span>
        </button>
      </template>

      <span class="setting-group-label">{{ t('systemSettings.advanced') }}</span>
      <button class="setting-row as-btn" @click="pickGatewayMode">
        <span class="sr-name">{{ t('systemSettings.gatewayMode') }}</span>
        <span class="sr-value">{{ optLabelSimple(gmOpts, appSettings.gatewayMode) }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="pickLogLevel">
        <span class="sr-name">{{ t('systemSettings.logLevel') }}</span>
        <span class="sr-value">{{ appSettings.logLevel }}<span class="sr-chev">›</span></span>
      </button>
      <div class="setting-row">
        <span class="sr-name">{{ t('systemSettings.autoUpdate') }}</span>
        <button class="switch" :class="{ on: appSettings.automaticUpdateCheck }" role="switch" :aria-checked="!!appSettings.automaticUpdateCheck" @click="saveAppSetting('automaticUpdateCheck', !appSettings.automaticUpdateCheck)"></button>
      </div>

      <!-- Everything the gateway has loaded, the Visualizer included: one way
           in, so the same plugin is not listed twice on one page. -->
      <span class="setting-group-label">{{ t('systemSettings.integrations') }}</span>
      <button class="setting-row as-btn" @click="showPlugins = true">
        <span class="sr-main">
          <span class="sr-name">{{ t('systemSettings.plugins') }}</span>
          <span class="sr-sub">{{ t('systemSettings.pluginsSub') }}</span>
        </span>
        <span class="sr-value muted">{{ pluginCount || '' }}<span class="sr-chev">›</span></span>
      </button>
    </div>

    <PluginsPanel v-if="showPlugins" @close="showPlugins = false" />
  </div>
</template>
