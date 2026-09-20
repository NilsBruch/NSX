<script setup>
/**
 * The machine's own on/off switch, top left — the mirror of PowerButton on the
 * right, which is about the DISPLAY (lock screen), not the machine. Lives in
 * the tablet chrome because turning the machine on is the first thing anyone
 * does, and it used to sit three levels deep in Settings (the old
 * MachineWidget, now gone).
 *
 * Pressed in and lit = the machine is on; out and dark = asleep. The exact
 * state ("Ready" / "Heating" / a time to ready) is the StatusIsland's job,
 * 22px above and centred: this button says on or off and nothing finer, so
 * heating still reads as ON here rather than as a third half-state.
 *
 * As in MachineWidget before it, the REST call is a one-way trigger — the
 * switch follows machine.state from the gateway's own stream (useCore.js),
 * never an optimistic local flip, so it can never disagree with the island.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine } from '../composables/useCore.js';
import { showToast } from '../composables/useToast.js';

const { t } = useI18n();
const { NSXApi } = window;

const on = computed(() => machine.state !== 'sleeping');
// Nothing to switch with no machine on the other end: dimmed and inert rather
// than hidden, so the corner doesn't empty out whenever the link drops.
const disabled = computed(() => !machine.connected);

const busy = ref(false);
async function toggle() {
  if (busy.value || disabled.value) return;
  busy.value = true;
  try {
    await NSXApi.setMachineState(on.value ? 'sleeping' : 'idle');
  } catch (err) {
    showToast(t('toast.controlFailed') + ': ' + err.message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    class="machine-btn"
    :class="{ on }"
    role="switch"
    :aria-checked="on"
    :aria-label="t('settingsPage.machine')"
    :disabled="disabled || busy"
    @click="toggle"
  >
    <!-- The standard power glyph — a broken ring with a bar through the gap.
         This one DOES mean power: unlike the crescent opposite it, it is the
         machine that goes off. -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5v8" />
      <path d="M7.3 6.4a7 7 0 1 0 9.4 0" />
    </svg>
  </button>
</template>
