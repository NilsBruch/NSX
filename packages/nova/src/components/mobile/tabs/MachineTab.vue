<script setup>
/**
 * Phone "Machine" — the DE1's own state and, eventually (see the mobile
 * parity plan), the steam / hot water / rinse parameters the tablet spreads
 * across three separate rails. For now this is just the status card that used
 * to be phone Home's: connected state, water level, and the one piece of live
 * control this shell keeps — sleep. Sleep is not a dispense action (it can't
 * heat, pour or move water), which is why it stays available here while the
 * phone otherwise never starts anything on the machine remotely.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine } from '../../../composables/useCore.js';
import { skinSettings } from '../../../composables/useSettings.js';
import { formatWaterLevel } from '../../../utils/water.js';
import { showToast } from '../../../composables/useToast.js';

const { t } = useI18n();
const { NSXApi } = window;

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
  </section>
</template>
