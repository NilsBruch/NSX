<script setup>
/**
 * Which devices are paired and whether they are connected, with the same
 * tap-to-connect rows AppPanel carries — this is the one thing on the settings
 * page you look at when something isn't working, and it was two taps deep.
 *
 * AppPanel keeps its own copy: it also owns the preferred-device and
 * scale-power settings that belong beside the list there. Both read the same
 * `devices` ref, so they can never disagree.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { devices, loadDevices, scanForDevices, connectToDevice, disconnectDevice, appSettings, loadAppSettings } from '../../composables/useSettings.js';

const { t } = useI18n();

onMounted(() => { loadDevices(); loadAppSettings(); });

// Every scale that was ever paired stays in the gateway's device list, so a
// household that has tried three of them got a widget three rows too long.
// Only one machine and one scale can be in use at a time, so show only one of
// each: the connected one, else the preferred one (what we auto-connect to on
// startup), else whatever the gateway lists first. The full list is still
// reachable in App settings, where the preferred-device pickers live.
function pickDevice(type) {
  const list = devices.value.filter((d) => d.type === type);
  const preferredId = type === 'machine' ? appSettings.preferredMachineId : appSettings.preferredScaleId;
  return list.find((d) => d.connected) || list.find((d) => d.id === preferredId) || list[0] || null;
}

// DE1 first, scale after — the machine is the primary device.
const orderedDevices = computed(() => [pickDevice('machine'), pickDevice('scale')].filter(Boolean));

function toggleDevice(d) {
  if (d.connected) disconnectDevice(d.id);
  else connectToDevice(d.id);
}
</script>

<template>
  <div class="swidget">
    <div class="sw-head">
      <span class="sw-title">{{ t('settingsPage.connection') }}</span>
      <button class="scan-btn" @click="scanForDevices">{{ t('machineSettings.scan') }}</button>
    </div>
    <button v-for="d in orderedDevices" :key="d.id" class="sw-row as-btn device-row" @click="toggleDevice(d)">
      <span class="dev-dot" :class="{ on: d.connected }"></span>
      <span class="sr-main">
        <span class="sr-name">{{ d.name }}</span>
        <span class="sr-sub">{{ d.type === 'scale' ? t('machineSettings.scale') : t('machineSettings.machine') }}</span>
      </span>
      <span class="dev-status" :class="{ on: d.connected }">{{ d.connected ? t('settingsPage.connected') : t('settingsPage.disconnected') }}</span>
    </button>
    <div v-if="!orderedDevices.length" class="sw-row">
      <span class="sr-sub">{{ t('settingsPage.noDevices') }}</span>
    </div>
  </div>
</template>
