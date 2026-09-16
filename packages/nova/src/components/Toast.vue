<script setup>
import { toastState } from '../composables/useToast.js';
</script>

<template>
  <div v-if="toastState.visible" class="toast" :class="`toast-${toastState.position}`">{{ toastState.message }}</div>
</template>
