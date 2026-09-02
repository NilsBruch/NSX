<script setup>
/**
 * Machine power, lifted off the old Machine tile — that switch used to be
 * overlaid on the tile itself, which no longer has room for it now the tiles
 * are small. Here it gets a card of its own, and the state it switches
 * between can finally be written out next to it.
 *
 * The state word is the plain machine state, NOT StatusIsland's refined one:
 * the island's "heating" is a heuristic over group temperature that lives with
 * the island, and it sits 60px above this card already showing that version.
 * Duplicating the heuristic to say the same thing twice would be worse than
 * saying the simpler true thing once.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine } from '../../composables/useCore.js';
import { showToast } from '../../composables/useToast.js';

const { t } = useI18n();
const { NSXApi } = window;

const on = computed(() => machine.state !== 'sleeping');
const stateLabel = computed(() => {
  if (!machine.connected) return t('status.noMachine');
  return t(`status.${machine.state === 'idle' ? 'ready' : machine.state}`);
});

const busy = ref(false);
async function toggle() {
  if (busy.value) return;
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
  <div class="swidget">
    <span class="sw-title">{{ t('settingsPage.machine') }}</span>
    <div class="sw-row">
      <span class="sw-name">{{ stateLabel }}</span>
      <button class="switch" :class="{ on }" role="switch" :aria-checked="on" :disabled="busy" @click="toggle"></button>
    </div>
  </div>
</template>
