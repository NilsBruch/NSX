<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders } from '../../composables/useCore.js';
import GrinderEditor from './GrinderEditor.vue';

defineEmits(['close']);
const { t } = useI18n();

/**
 * Everything a grinder record holds, on two lines under its model: the burrs
 * on one, how it adjusts on the other. Both lines are always rendered — a
 * grinder with nothing filled in gets the dash rather than a shorter row, so
 * the list stays an even column instead of stepping up and down.
 *
 * Each line is one line: long preset values are cut with an ellipsis rather
 * than wrapping, which is what keeps every row exactly the same height.
 */
const burrLine = (g) => [
  g.burrs,
  g.burrSize !== '' && g.burrSize != null ? `${g.burrSize} mm` : null,
  g.burrType ? t(`grinderEditor.${g.burrType}`) : null,
].filter(Boolean).join(' · ') || '—';

const adjustLine = (g) => {
  if (g.settingType === 'preset') {
    const values = Array.isArray(g.settingValues) ? g.settingValues.join(', ') : '';
    return values ? `${t('grinderEditor.positions')}: ${values}` : t('grinderEditor.positions');
  }
  const steps = [
    g.settingSmallStep !== '' && g.settingSmallStep != null ? `${t('grinderEditor.smallStep')} ${g.settingSmallStep}` : null,
    g.settingBigStep !== '' && g.settingBigStep != null ? `${t('grinderEditor.bigStep')} ${g.settingBigStep}` : null,
  ].filter(Boolean).join(' · ');
  return steps ? `${t('grinderEditor.stepless')} · ${steps}` : t('grinderEditor.stepless');
};

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
      <button v-for="g in grinders" :key="g.id" class="setting-row as-btn grinder-row" @click="openEdit(g)">
        <span class="sr-main">
          <span class="sr-name">{{ g.model || '—' }}</span>
          <span class="sr-sub">{{ burrLine(g) }}</span>
          <span class="sr-sub">{{ adjustLine(g) }}</span>
        </span>
        <span class="sr-chev">›</span>
      </button>
      <div v-if="!grinders.length" class="setting-row"><span class="sr-value muted">{{ t('common.notSet') }}</span></div>
    </div>

    <div class="bean-actions">
      <button class="act-btn accent grow" @click="openNew">{{ t('grinderEditor.newTitle') }}</button>
    </div>

    <PageTransition>
      <GrinderEditor v-if="showEditor" :grinder="editing" @close="closeEditor" @saved="closeEditor" @deleted="closeEditor" />
    </PageTransition>
  </div>
</template>
