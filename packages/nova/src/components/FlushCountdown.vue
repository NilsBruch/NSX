<script setup>
/**
 * The group-head flush, as a centred countdown ring (LiveRing.vue — see it for
 * why this weight of readout exists at all).
 *
 * The countdown's total is the MACHINE's own `flushTimeout` setting — the
 * gateway is what actually ends the flush, so anything else here would drift
 * from the real thing. It's loaded lazily on the first flush (the user may
 * never have opened the Machine settings panel), which is also why the number
 * shows a dash for the one frame before it lands rather than counting down
 * from a guessed total and then jumping.
 *
 * A machine whose timeout is 0/unset flushes until the paddle is released, so
 * there is nothing to count DOWN from — the ring stays full and the number
 * counts up instead.
 *
 * The stop button is the same one steam and hot water carry, in the same
 * place: a flush usually ends itself, but a flush started by accident (or one
 * on a machine with no timeout at all) otherwise has no on-screen way out.
 * machine.js's ALLOWED_OPERATIONS permits setState from `flush`, so the guard
 * below is the same one those two use.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine } from '../composables/useCore.js';
import { machineSettings, loadMachineSettings } from '../composables/useSettings.js';
import LiveRing from './LiveRing.vue';

const { t } = useI18n();
const { NSXCore, NSXApi } = window;

const visible = computed(() => machine.state === 'flush');

// null until the machine settings have loaded; 0/absent means "no timeout".
const total = computed(() => {
  const v = Number(machineSettings.flushTimeout);
  return Number.isFinite(v) ? v : null;
});
const hasTotal = computed(() => total.value != null && total.value > 0);

const elapsedSec = ref(0);
const remaining = computed(() => (hasTotal.value ? Math.max(0, total.value - elapsedSec.value) : elapsedSec.value));
const label = computed(() => (total.value == null ? '—' : String(Math.ceil(remaining.value))));
const progress = computed(() => (hasTotal.value ? remaining.value / total.value : null));

let startMs = 0;
let timer = null;
function tick() {
  elapsedSec.value = (Date.now() - startMs) / 1000;
}

watch(visible, (on) => {
  if (on) {
    startMs = Date.now();
    elapsedSec.value = 0;
    // Lazily, exactly once: an already-populated cache re-resolves immediately.
    if (total.value == null) loadMachineSettings().catch(() => { /* dash stays */ });
    // 100ms, not 1s: the ring should sweep smoothly even though the number
    // only changes once a second.
    timer = setInterval(tick, 100);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
onUnmounted(() => { if (timer) clearInterval(timer); });

async function stop() {
  if (!NSXCore.canExecuteOperation('setState', machine.state)) return;
  await NSXApi.setMachineState('idle');
}
</script>

<template>
  <LiveRing v-if="visible" :value="label" :progress="progress">
    <button class="rate-btn" @click="stop">{{ t('common.stop') }}</button>
  </LiveRing>
</template>
