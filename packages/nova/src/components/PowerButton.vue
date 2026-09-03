<script setup>
/**
 * Puts the machine to sleep AND locks the screen — see useScreensaver.js for why
 * these are two separate things everywhere else. The REST call is a one-way
 * trigger, not an optimistic local flip; machine.state itself is set only by the
 * gateway's own machineState stream (see useCore.js).
 */
import { lock } from '../composables/useScreensaver.js';

const { NSXApi } = window;

async function sleep() {
  try {
    await NSXApi.setMachineState('sleeping');
    lock();
  } catch (err) {
    console.error('[Nova] failed to put the machine to sleep', err);
  }
}
</script>

<template>
  <button class="power-btn" aria-label="Sleep" @click="sleep">
    <!-- A crescent, not a power symbol: this button does not cut the power, it
         puts the machine to sleep and locks the screen. One closed path, drawn
         as the arc of the disc minus the arc that bites it — a stroked shape,
         so it inherits the same 1.8 stroke every other icon in the skin uses. -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7z" />
    </svg>
  </button>
</template>
