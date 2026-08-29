<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ProfilePicker from '../components/ProfilePicker.vue';
import GrinderPanel from '../components/settings/GrinderPanel.vue';
import MachinePanel from '../components/settings/MachinePanel.vue';
import SkinPanel from '../components/settings/SkinPanel.vue';
import AppPanel from '../components/settings/AppPanel.vue';
import SchedulePanel from '../components/settings/SchedulePanel.vue';
import VerticalSlider from '../components/VerticalSlider.vue';
import { displayBrightness, loadDisplayBrightness, setBrightness, displaySupport } from '../composables/useSettings.js';
import { machine } from '../composables/useCore.js';
import { showToast } from '../composables/useToast.js';

const { t } = useI18n();
const { NSXApi } = window;

// See loadDisplayBrightness's own doc comment: the module-load-time initial
// value is a placeholder read before the store has actually loaded, so this
// re-syncs it to what's really saved once the view mounts.
onMounted(loadDisplayBrightness);

const TILES = [
  { id: 'machine', label: 'settingsPage.machine', icon: 'M8 7h8M9 11h6a3 3 0 0 1-3 3 3 3 0 0 1-3-3z' },
  { id: 'app', label: 'settingsPage.app', icon: 'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.5a7.7 7.7 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.7 7.7 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5z' },
  { id: 'skin', label: 'settingsPage.skin', icon: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' },
  { id: 'profiles', label: 'settingsPage.profiles', icon: 'M4 19h16 M4 16c3 0 3-9 6-9s3 6 5 6 3-2 5-2' },
  { id: 'grinders', label: 'settingsPage.grinders', icon: 'M9 3h6l-1 5h-4L9 3z M8 8h8v6H8z M10 14v4h4v-4' },
  { id: 'schedule', label: 'scheduleSettings.title', icon: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
];

const active = ref(null);

// Machine on/off, lifted out of the old MachineWidget so the state toggle now
// lives directly on the machine tile.
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
</script>

<template>
  <section class="page">
    <h1 class="page-title">{{ t('tab.settings') }}</h1>
    <div class="settings-body">
      <div class="settings-tiles">
        <div v-for="tile in TILES" :key="tile.id" class="tile-slot">
          <button class="tile" @click="active = tile.id">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tile.icon" /></svg>
            <span class="tl">{{ t(tile.label) }}</span>
          </button>
          <button
            v-if="tile.id === 'machine'"
            class="switch tile-switch"
            :class="{ on: machineOn }"
            role="switch"
            :aria-checked="machineOn"
            :disabled="machineBusy"
            @click.stop="toggleMachine"
          ></button>
        </div>
      </div>
      <!-- Nothing to drive where the host has no backlight control (core's
           display domain, from GET /api/v1/display's platformSupported). -->
      <VerticalSlider
        v-if="displaySupport.brightness"
        class="settings-brightness"
        :model-value="displayBrightness"
        :min="10"
        :max="100"
        @update:model-value="setBrightness"
      />
    </div>

    <ProfilePicker v-if="active === 'profiles'" mode="manage" @back="active = null" />
    <GrinderPanel v-if="active === 'grinders'" @close="active = null" />
    <MachinePanel v-if="active === 'machine'" @close="active = null" />
    <SkinPanel v-if="active === 'skin'" @close="active = null" />
    <AppPanel v-if="active === 'app'" @close="active = null" />
    <SchedulePanel v-if="active === 'schedule'" @close="active = null" />
  </section>
</template>
