<script setup>
/**
 * The one place you set up what a shot is pulled with: grinders, filter
 * baskets, and the rest of the kit. Three sections in one panel rather than
 * three settings tiles — they're the same kind of thing to the user, even
 * though they are not the same kind of thing underneath:
 *
 *   grinders            -> /api/v1/grinders, a typed bridge resource
 *   baskets, equipment  -> DYE2's KV namespace, whole-array rewrites
 *
 * That difference is why each section keeps its own save path (core's
 * grinder vs equipment domain) instead of a shared one. The KV half also has
 * no push channel, so it is re-read on open and whenever the tab comes back
 * — a basket added in DYE2 otherwise never shows up here.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders, baskets, equipment } from '../../composables/useCore.js';
import { skinSettings } from '../../composables/useSettings.js';
import { reportRuntimeError } from '../../composables/useErrorReporting.js';
import GrinderEditor from './GrinderEditor.vue';
import BasketEditor from './BasketEditor.vue';
import EquipmentEditor from './EquipmentEditor.vue';

defineEmits(['close']);
const { t } = useI18n();
const { NSXCore } = window;

/** Grinder rows keep NSX's two-line summary: burrs, then how it adjusts. */
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

const basketLine = (b) => [
  b.size ? t(`basketEditor.${b.size}`, b.size) : null,
  b.diameterMm != null && b.diameterMm !== '' ? `${b.diameterMm} mm` : null,
  b.notes,
].filter(Boolean).join(' · ') || '—';

/** The kit row shows the fields the user named, not a count. */
const equipmentLine = (e) => {
  const fields = NSXCore.getCustomFields(e);
  return fields.length ? fields.map((f) => (f.value ? `${f.key}: ${f.value}` : f.key)).join(' · ') : '—';
};

// Which editor is open, and on what. `kind` is null when none is.
const editing = ref(null); // { kind: 'grinder'|'basket'|'equipment', row: object|null }
const openNew = (kind) => { editing.value = { kind, row: null }; };
const openEdit = (kind, row) => { editing.value = { kind, row }; };
const closeEditor = () => { editing.value = null; };

async function refreshKv() {
  // Nothing to fetch with the integration off — the two sections aren't
  // rendered, and the panel is then just the grinder list it used to be.
  if (!skinSettings.dyeButton) return;
  try {
    await NSXCore.loadEquipmentLibrary();
  } catch (err) {
    // A KV store that can't be read leaves the two sections empty rather than
    // taking the panel (and the grinders in it) down with it.
    reportRuntimeError('equipment library', err);
  }
}
const onVisible = () => { if (document.visibilityState === 'visible') refreshKv(); };

onMounted(() => {
  refreshKv();
  document.addEventListener('visibilitychange', onVisible);
});
onUnmounted(() => document.removeEventListener('visibilitychange', onVisible));
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ t('settingsPage.equipment') }}</span>
    </div>

    <div class="settings-scroll">
      <span class="setting-group-label">{{ t('settingsPage.grinders') }}</span>
      <button v-for="g in grinders" :key="g.id" class="setting-row as-btn grinder-row" @click="openEdit('grinder', g)">
        <span class="sr-main">
          <span class="sr-name">{{ g.model || '—' }}</span>
          <span class="sr-sub">{{ burrLine(g) }}</span>
          <span class="sr-sub">{{ adjustLine(g) }}</span>
        </span>
        <span class="sr-chev">›</span>
      </button>
      <button class="setting-row as-btn eq-add" @click="openNew('grinder')">
        <span class="sr-name">{{ t('grinderEditor.newTitle') }}</span>
        <span class="sr-value">+</span>
      </button>

      <!-- Baskets and kit come from the DYE2 plugin's store, so they follow
           the integration toggle: off, this panel is the grinder list alone. -->
      <template v-if="skinSettings.dyeButton">
      <span class="setting-group-label">{{ t('settingsPage.baskets') }}</span>
      <button v-for="b in baskets" :key="b.id" class="setting-row as-btn" @click="openEdit('basket', b)">
        <span class="sr-main">
          <span class="sr-name">{{ b.name || '—' }}</span>
          <span class="sr-sub">{{ basketLine(b) }}</span>
        </span>
        <span class="sr-chev">›</span>
      </button>
      <button class="setting-row as-btn eq-add" @click="openNew('basket')">
        <span class="sr-name">{{ t('basketEditor.newTitle') }}</span>
        <span class="sr-value">+</span>
      </button>

      <span class="setting-group-label">{{ t('settingsPage.otherEquipment') }}</span>
      <button v-for="e in equipment" :key="e.id" class="setting-row as-btn" @click="openEdit('equipment', e)">
        <span class="sr-main">
          <span class="sr-name">{{ e.name || '—' }}</span>
          <span class="sr-sub">{{ equipmentLine(e) }}</span>
        </span>
        <span class="sr-chev">›</span>
      </button>
      <button class="setting-row as-btn eq-add" @click="openNew('equipment')">
        <span class="sr-name">{{ t('equipmentEditor.newTitle') }}</span>
        <span class="sr-value">+</span>
      </button>

      <!-- Says where the two KV-backed sections actually live, because a
           basket added here showing up in DYE2 is the point of them. -->
      <p class="eq-hint">{{ t('settingsPage.sharedHint') }}</p>
      </template>
    </div>

    <PageTransition>
      <GrinderEditor
        v-if="editing?.kind === 'grinder'" :grinder="editing.row"
        @close="closeEditor" @saved="closeEditor" @deleted="closeEditor"
      />
    </PageTransition>
    <PageTransition>
      <BasketEditor
        v-if="editing?.kind === 'basket'" :basket="editing.row"
        @close="closeEditor" @saved="closeEditor" @deleted="closeEditor"
      />
    </PageTransition>
    <PageTransition>
      <EquipmentEditor
        v-if="editing?.kind === 'equipment'" :item="editing.row"
        @close="closeEditor" @saved="closeEditor" @deleted="closeEditor"
      />
    </PageTransition>
  </div>
</template>
