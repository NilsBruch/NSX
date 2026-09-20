<script setup>
/**
 * Phone "Settings" — same tile set and same panel components as
 * SettingsView.vue (which are already `position:fixed inset:0` full-screen
 * overlays, see app.css), just triggered from a single-column tile list
 * instead of the tablet's two columns of widget cards. The widgets above the
 * tile list are SettingsView's own left column, in the same order. The
 * machine's own on/off switch is not among them on either layout: the tablet
 * has it in the chrome (MachinePowerButton) and the phone, which has no
 * chrome, shows it as the first thing in MachineTab.vue.
 * All four widgets are already `.swidget`-shaped, the same card EnergyWidget
 * below has always used on this page — no phone-specific width fix was
 * needed for any of them (unlike the settings PANELS, which do carry a few
 * hardcoded tablet widths — see phone.css section 10).
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { displaySupport } from '../../../composables/useSettings.js';
import ProfilePicker from '../../ProfilePicker.vue';
import GrinderPanel from '../../settings/GrinderPanel.vue';
import MachinePanel from '../../settings/MachinePanel.vue';
import SkinPanel from '../../settings/SkinPanel.vue';
import AppPanel from '../../settings/AppPanel.vue';
import UpdateWidget from '../../settings/UpdateWidget.vue';
import DisplayWidget from '../../settings/DisplayWidget.vue';
import ConnectionWidget from '../../settings/ConnectionWidget.vue';
import EnergyWidget from '../../settings/EnergyWidget.vue';

const { t } = useI18n();

const TILES = [
  { id: 'machine', label: 'settingsPage.machine', icon: 'M8 7h8M9 11h6a3 3 0 0 1-3 3 3 3 0 0 1-3-3z' },
  { id: 'app', label: 'settingsPage.app', icon: 'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.5a7.7 7.7 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.7 7.7 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5z' },
  { id: 'skin', label: 'settingsPage.skin', icon: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' },
  // Equipment libraries — matches SettingsView.vue's EQUIPMENT_TILES grouping
  // and icons exactly, just flattened into one list instead of two TileCards.
  { id: 'profiles', label: 'settingsPage.profiles', icon: 'M4 19h16 M4 16c3 0 3-9 6-9s3 6 5 6 3-2 5-2' },
  { id: 'grinders', label: 'settingsPage.grinders', icon: 'M9 3h6l-1 5h-4L9 3z M8 8h8v6H8z M10 14v4h4v-4' },
];

const active = ref(null);
</script>

<template>
  <section class="phone-page">
    <h1 class="phone-title">{{ t('tab.settings') }}</h1>

    <UpdateWidget />
    <!-- Nothing to drive where the host has no backlight control (core's
         display domain, from GET /api/v1/display's platformSupported) —
         same guard SettingsView.vue uses. -->
    <DisplayWidget v-if="displaySupport.brightness" />
    <ConnectionWidget />
    <!-- The Schedule tile is gone with SchedulePanel; the same Energy card the
         tablet grew carries the weekly plan here, so it stays reachable from
         the phone rather than becoming tablet-only. It is a single column of
         rows already, so it needs no phone variant. -->
    <EnergyWidget />

    <div class="phone-list">
      <button v-for="tile in TILES" :key="tile.id" class="phone-list-row" @click="active = tile.id">
        <span class="phone-tile-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tile.icon" /></svg></span>
        <span class="rmeta">{{ t(tile.label) }}</span>
        <span class="chev">›</span>
      </button>
    </div>

    <PageTransition>
      <ProfilePicker v-if="active === 'profiles'" mode="manage" @back="active = null" />
    </PageTransition>
    <PageTransition>
      <GrinderPanel v-if="active === 'grinders'" @close="active = null" />
    </PageTransition>
    <PageTransition>
      <MachinePanel v-if="active === 'machine'" @close="active = null" />
    </PageTransition>
    <PageTransition>
      <SkinPanel v-if="active === 'skin'" @close="active = null" />
    </PageTransition>
    <PageTransition>
      <AppPanel v-if="active === 'app'" @close="active = null" />
    </PageTransition>
  </section>
</template>
