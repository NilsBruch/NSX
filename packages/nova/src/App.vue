<script setup>
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAccent } from './composables/useAccent.js';
import { locked } from './composables/useScreensaver.js';
import { phase as liveShotPhase } from './composables/useLiveShot.js';
import { isPhone } from './composables/useLayout.js';
import { phoneTab } from './composables/usePhoneNav.js';
import RegisterRail from './components/RegisterRail.vue';
import StatusIsland from './components/StatusIsland.vue';
import PowerButton from './components/PowerButton.vue';
import Screensaver from './components/Screensaver.vue';
import WheelPicker from './components/WheelPicker.vue';
import TextFieldModal from './components/TextFieldModal.vue';
import NumberPad from './components/NumberPad.vue';
import ChooserModal from './components/ChooserModal.vue';
import ConfirmModal from './components/ConfirmModal.vue';
import RatingModal from './components/RatingModal.vue';
import Toast from './components/Toast.vue';
import LiveShotOverlay from './components/LiveShotOverlay.vue';
import SimpleLiveOverlay from './components/SimpleLiveOverlay.vue';
import FlushCountdown from './components/FlushCountdown.vue';
import MobileShell from './components/mobile/MobileShell.vue';
import ShotReview from './components/mobile/ShotReview.vue';

const route = useRoute();

// A phone tab has no router entry of its own (usePhoneNav.js), so it maps
// onto whichever tablet tab shares its concern purely to borrow that tab's
// colour — see PHONE_TABS in usePhoneNav.js for the mapping. Without this the
// whole phone UI stayed on whatever `route.name` last was, which is always
// 'espresso': the phone never navigates the router, so whichever tab loaded
// first painted every phone screen in its colour for the rest of the session.
const PHONE_TAB_ACCENT_SOURCE = { recipes: 'espresso', machine: 'cleaning', diary: 'diary', settings: 'settings' };
const accentTabName = computed(() => (isPhone.value ? PHONE_TAB_ACCENT_SOURCE[phoneTab.value] : route.name));

// Paints the whole document in the active tab's colour — see useAccent.js for
// why the palette never left the rail before this.
useAccent(accentTabName);

// phone.css targets this to scope its rules without leaking into the tablet
// stylesheet's class names.
watch(isPhone, (v) => { document.body.dataset.phone = v ? 'true' : 'false'; }, { immediate: true });
</script>

<template>
  <template v-if="isPhone">
    <MobileShell />
    <!-- Shares useLiveShot.js's `phase` state with the tablet's LiveShotOverlay
         (DiaryTab calls openHistoryAt() the same way DiaryView.vue does) —
         only ever renders the read+rate 'history' screen, never 'live',
         matching the browse-only companion scope (see the mobile parity plan
         for when that changes). -->
    <ShotReview />
  </template>

  <div v-else class="stage">
    <RegisterRail side="left" />
    <StatusIsland />
    <PowerButton />
    <main class="pages">
      <RouterView />
    </main>
    <RegisterRail side="right" />

    <!-- Global: a hardware-triggered shot/steam/hot-water can start while the
         user is on any tab, not just its own page — see the design log. -->
    <LiveShotOverlay v-if="liveShotPhase !== 'hidden'" />
    <SimpleLiveOverlay />
    <!-- A flush is housekeeping, not a beverage — a centred countdown rather
         than one of the two full-screen live overlays above. -->
    <FlushCountdown />

    <!-- Locked is NOT the same as "machine asleep" — see useScreensaver.js. Sleep
         always locks, but unlocking doesn't always wake the machine back up. -->
    <Screensaver v-if="locked" />
  </div>

  <!-- Single shared instances for BOTH layouts; any view/tab opens these via
       useModals.js. Nova's phone shell is a browse-only remote companion (no
       live shot control), so LiveShotOverlay/SimpleLiveOverlay/Screensaver
       stay tablet-only above. -->
  <WheelPicker />
  <TextFieldModal />
  <NumberPad />
  <ChooserModal />
  <ConfirmModal />
  <RatingModal />
  <Toast />
</template>
