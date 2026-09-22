<script setup>
/**
 * Two columns of widgets that read out and change state directly, plus the
 * navigation tiles kept but shrunk into two grouped cards. Before this the
 * page was six big buttons and a brightness rail: everything you actually
 * touch — cool-down, wake time, which devices are connected, whether the app
 * has an update — was one tap deep, so the page itself said nothing.
 *
 * Deliberately does not scroll: same `.page { overflow: hidden }` as every
 * other Nova view, so the widgets are sized to fit the tablet's panel rather
 * than growing a scrollbar the rest of the skin doesn't have.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ProfilePicker from '../components/ProfilePicker.vue';
import EquipmentPanel from '../components/settings/EquipmentPanel.vue';
import MachinePanel from '../components/settings/MachinePanel.vue';
import SkinPanel from '../components/settings/SkinPanel.vue';
import AppPanel from '../components/settings/AppPanel.vue';
import TileCard from '../components/settings/TileCard.vue';
import EnergyWidget from '../components/settings/EnergyWidget.vue';
import DisplayWidget from '../components/settings/DisplayWidget.vue';
import ConnectionWidget from '../components/settings/ConnectionWidget.vue';
import UpdateWidget from '../components/settings/UpdateWidget.vue';
import { displaySupport } from '../composables/useSettings.js';

const { t } = useI18n();

// The machine, the app it talks to, and how the skin looks — the three you
// change when something about the setup is wrong. Two columns, so Skin takes
// the full second row rather than sitting in a squeezed third column.
const SYSTEM_TILES = [
  { id: 'machine', label: 'settingsPage.machine', icon: 'M8 7h8M9 11h6a3 3 0 0 1-3 3 3 3 0 0 1-3-3z' },
  { id: 'app', label: 'settingsPage.app', icon: 'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.5a7.7 7.7 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.7 7.7 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5z' },
  { id: 'skin', label: 'settingsPage.skin', icon: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2', wide: true },
];
// The libraries you set up once and pick from while brewing. (Beans live in
// the Diary, next to the shots that used them — not here.)
const EQUIPMENT_TILES = [
  { id: 'profiles', label: 'settingsPage.profiles', icon: 'M4 19h16 M4 16c3 0 3-9 6-9s3 6 5 6 3-2 5-2' },
  // Grinders, baskets and the rest of the kit are one tile: they are the
  // same thing to the user (what a shot is pulled with), even though
  // grinders are a bridge resource and the other two live in DYE2's store.
  { id: 'equipment', label: 'settingsPage.equipment', icon: 'M4 7h16 M4 12h16 M4 17h16 M8 5v4 M15 10v4 M11 15v4' },
];

const active = ref(null);
</script>

<template>
  <section class="page">
    <h1 class="page-title">{{ t('tab.settings') }}</h1>
    <div class="settings-body">
      <div class="sw-col">
        <UpdateWidget />
        <!-- Nothing to drive where the host has no backlight control (core's
             display domain, from GET /api/v1/display's platformSupported). -->
        <DisplayWidget v-if="displaySupport.brightness" />
        <ConnectionWidget />
      </div>
      <div class="sw-col">
        <TileCard :tiles="SYSTEM_TILES.map((x) => ({ ...x, label: t(x.label) }))" @pick="active = $event" />
        <TileCard :tiles="EQUIPMENT_TILES.map((x) => ({ ...x, label: t(x.label) }))" @pick="active = $event" />
        <EnergyWidget />
      </div>
    </div>

    <PageTransition>
      <ProfilePicker v-if="active === 'profiles'" mode="manage" @back="active = null" />
    </PageTransition>
    <PageTransition>
      <EquipmentPanel v-if="active === 'equipment'" @close="active = null" />
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
