<script setup>
import { useI18n } from 'vue-i18n';
import { PHONE_TABS, phoneTab, goPhoneTab } from '../../composables/usePhoneNav.js';

const { t } = useI18n();
</script>

<template>
  <nav class="phone-tabs" aria-label="Nova mobile navigation">
    <button
      v-for="tab in PHONE_TABS"
      :key="tab.id"
      class="phone-tab"
      :class="{ active: phoneTab === tab.id }"
      :style="{ '--accent': tab.accent }"
      :aria-pressed="phoneTab === tab.id"
      :aria-label="t(tab.labelKey)"
      @click="goPhoneTab(tab.id)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" v-html="tab.icon"></svg>
      <span>{{ t(tab.labelKey) }}</span>
    </button>
  </nav>
</template>
