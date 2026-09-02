<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders } from '../../composables/useCore.js';
import GrinderEditor from './GrinderEditor.vue';

defineEmits(['close']);
const { t } = useI18n();

const editing = ref(null); // grinder object, or null for "new"
const showEditor = ref(false);
function openNew() { editing.value = null; showEditor.value = true; }
function openEdit(g) { editing.value = g; showEditor.value = true; }
function closeEditor() { showEditor.value = false; }
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ t('settingsPage.grinders') }}</span>
    </div>

    <div class="settings-scroll">
      <button v-for="g in grinders" :key="g.id" class="setting-row as-btn" @click="openEdit(g)">
        <span class="sr-main">
          <span class="sr-name">{{ g.model || '—' }}</span>
          <span v-if="g.burrs" class="sr-sub">{{ g.burrs }}</span>
        </span>
        <span class="sr-chev">›</span>
      </button>
      <div v-if="!grinders.length" class="setting-row"><span class="sr-value muted">{{ t('common.notSet') }}</span></div>
    </div>

    <div class="bean-actions">
      <button class="act-btn accent grow" @click="openNew">{{ t('grinderEditor.newTitle') }}</button>
    </div>

    <GrinderEditor v-if="showEditor" :grinder="editing" @close="closeEditor" @saved="closeEditor" @deleted="closeEditor" />
  </div>
</template>
