<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAccent } from './composables/useAccent.js';
import { locked } from './composables/useScreensaver.js';
import { phase as liveShotPhase } from './composables/useLiveShot.js';
import { isPhone } from './composables/useLayout.js';
import { phoneTab } from './composables/usePhoneNav.js';
import RegisterRail from './components/RegisterRail.vue';
import StatusIsland from './components/StatusIsland.vue';
import MachinePowerButton from './components/MachinePowerButton.vue';
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

const route = useRoute();

/**
 * Which transition the shot overlay mounts and unmounts with: `page` while it
 * is the shot HISTORY, none for the live shot. Remembered from the last
 * VISIBLE phase, because closing history sets the phase to 'hidden' first —
 * reading the phase then would find nothing to animate out. Synchronous, so
 * the name is right before the render that mounts the overlay reads it.
 *
 * A live shot turning into its history keeps the overlay mounted, so that
 * switch is not a transition at all: the review replaces the live view where
 * it stands.
 */
const overlayTransition = ref('');
watch(liveShotPhase, (p) => {
  if (p !== 'hidden') overlayTransition.value = p === 'history' ? 'page' : 'none';
}, { flush: 'sync', immediate: true });

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
  </template>

  <div v-else class="stage">
    <RegisterRail side="left" />
    <StatusIsland />
    <!-- The two corners of the chrome are two different devices: the machine
         on the left, the display (lock screen) on the right. -->
    <MachinePowerButton />
    <PowerButton />
    <main class="pages">
      <RouterView />
    </main>
    <RegisterRail side="right" />

    <!-- Locked is NOT the same as "machine asleep" — see useScreensaver.js. Sleep
         always locks, but unlocking doesn't always wake the machine back up.
         Tablet-only kiosk chrome, along with RegisterRail/StatusIsland/
         MachinePowerButton/PowerButton above: meaningless on a phone, which has
         no lock screen
         of its own to show. -->
    <!-- Teleported out of .stage: opening a page pushes .stage off to the left
         (PageTransition), and a lock screen inside it would go with it. -->
    <Teleport to="body">
      <Screensaver v-if="locked" />
    </Teleport>
  </div>

  <!-- Global, BOTH layouts: a hardware-triggered shot/steam/hot-water/flush
       can start while the user is on any tab (tablet) or any phone tab, and
       these three are what let it be seen no matter where that is.
       The phone's own invariant — display and stop, never start — is
       enforced by what these three components DO, not by hiding controls
       here: LiveShotOverlay's only writes are skipStep() and shot
       annotations, plus (isPhone-only) a stop button guarded by
       NSXCore.canExecuteOperation('stopShot', ...); SimpleLiveOverlay and
       FlushCountdown each write exactly one thing, setMachineState('idle').
       None of the three can START a dispense — the one component that can
       (CleaningAssistant.vue) is simply never mounted on the phone. -->
  <!-- Shot history slides in and out like every other page with a Back
       button (PageTransition, pushing the app aside); the live shot does not — it has to be
       there the instant the machine starts pouring. See overlayTransition. -->
  <PageTransition :name="overlayTransition">
    <LiveShotOverlay v-if="liveShotPhase !== 'hidden'" />
  </PageTransition>
  <SimpleLiveOverlay />
  <!-- A flush is housekeeping, not a beverage — a centred countdown rather
       than one of the two full-screen live overlays above. -->
  <FlushCountdown />

  <!-- Single shared instances for BOTH layouts; any view/tab opens these via
       useModals.js. -->
  <WheelPicker />
  <TextFieldModal />
  <NumberPad />
  <ChooserModal />
  <ConfirmModal />
  <RatingModal />
  <Toast />
</template>
