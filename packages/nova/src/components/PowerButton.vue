<script setup>
/**
 * Puts the machine to sleep AND locks the screen — see useScreensaver.js for why
 * these are two separate things everywhere else. The REST call is a one-way
 * trigger, not an optimistic local flip; machine.state itself is set only by the
 * gateway's own machineState stream (see useCore.js).
 */
import { lock, markOwnSleepRequest } from '../composables/useScreensaver.js';

const { NSXApi } = window;

async function sleep() {
  try {
    markOwnSleepRequest(); // locks right below; the transition needn't do it again
    await NSXApi.setMachineState('sleeping');
    lock();
  } catch (err) {
    console.error('[Nova] failed to put the machine to sleep', err);
  }
}
</script>

<template>
  <button class="power-btn" aria-label="Sleep" @click="sleep">
    <!-- A padlock, not a power symbol: the power symbol now belongs to
         MachinePowerButton in the opposite corner, and what this button leaves
         behind is the locked screen. Body and shackle as two stroked paths, so
         it inherits the same 1.8 stroke every other icon in the skin uses. -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 10.5h13v10h-13z" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  </button>
</template>
