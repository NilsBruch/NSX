<script setup>
/**
 * One bean's bags (batches) — Add / edit roast date / Delete. Reached from
 * the Diary's long-press menu on a bean row ("Bags"), both tablet
 * (DiaryView.vue) and phone (DiaryTab.vue) — the Diary already owns browsing
 * and editing beans themselves (grouping by roaster, search, BeanEditor,
 * archive/delete via useBeanActions.js); this covers the one thing nothing in
 * nova surfaced before: bags never had any UI at all, just an internal
 * batchId -> beanId map (useDiary.js's loadBatchMap) used purely for shot
 * attribution.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatShortDate } from '../composables/useCore.js';
import { useBeanBatches } from '../composables/useBeanBatches.js';
import { addBatch, setBatchRoastDate, confirmAndDeleteBatch } from '../composables/useBeanActions.js';
import RoastDatePicker from './RoastDatePicker.vue';

const props = defineProps({
  bean: { type: Object, required: true },
});
defineEmits(['close']);
const { t } = useI18n();
const { NSXCore } = window;

const { batches, loading: batchesLoading, failed: batchesFailed, load: loadBatches } = useBeanBatches();
// The panel is mounted fresh per bean (v-if in the Diary), so a plain call is
// enough — no prop to watch for a bean swap under it.
loadBatches(props.bean?.id);

// ── Batch actions ──
const showRoastPicker = ref(false);
const roastPickerTarget = ref(null); // existing batch being edited, or null = adding
function openAddBatch() { roastPickerTarget.value = null; showRoastPicker.value = true; }
function openEditBatch(batch) {
  roastPickerTarget.value = batch;
  // Surfaces the retroactive-shots caveat right as the picker for an EXISTING
  // bag opens (see useBeanActions.js's setBatchRoastDate) — Add has nothing
  // to warn about, only Edit rewrites an already-brewed bag's date.
  NSXCore.emit('toast', t('beanManager.roastDateWarning'));
  showRoastPicker.value = true;
}
async function onRoastConfirm(iso) {
  showRoastPicker.value = false;
  // Two bags on the same bean sharing a roast date collide with
  // resolveBatch's (beanId, roastDate) identity (core/domains/bean.js) —
  // the recipe/workflow layer would then have no reliable way to tell them
  // apart. Block it here rather than let it happen quietly.
  const target = roastPickerTarget.value;
  const clash = batches.value.some((b) => b.id !== target?.id && NSXCore.normalizeRoastDate(b.roastDate) === NSXCore.normalizeRoastDate(iso));
  if (clash) { NSXCore.emit('toast', t('beanManager.roastDateClash')); return; }
  if (target) await setBatchRoastDate(target, iso);
  else await addBatch(props.bean.id, iso);
  await loadBatches(props.bean.id);
}
async function deleteBatchRow(batch) {
  if (await confirmAndDeleteBatch(batch)) await loadBatches(props.bean.id);
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('diary.back') }}
      </button>
      <span class="ov-title">{{ bean?.roaster || '—' }} – {{ bean?.name || '—' }}</span>
    </div>

    <div class="pd-stages-list">
      <div v-for="b in batches" :key="b.id" class="pd-stage batch-row bag-row">
        <!-- Tapping the bag edits it — the same "tap the row, no separate
             pencil" convention the Diary's own rows use elsewhere (see
             DiaryView.vue's .row-main / .row-edit pairing) — Delete is the
             only action that still needs its own button, so it's the only
             one left, and bigger for being the sole target now. -->
        <button class="pd-stage-main" @click="openEditBatch(b)">
          <span class="pd-stage-name">{{ b.roastDate ? formatShortDate(b.roastDate) : t('diary.empty') }}</span>
          <span class="pd-stage-detail">{{ b.roastDate ? NSXCore.getBatchAge(b.roastDate) : '' }}<template v-if="b.archived"> · {{ t('diary.archive') }}</template></span>
        </button>
        <button class="batch-row-delete" :aria-label="t('common.delete')" @click="deleteBatchRow(b)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" /></svg>
        </button>
      </div>
      <div v-if="batchesLoading" class="pick-empty">{{ t('diary.loading') }}</div>
      <div v-else-if="batchesFailed" class="pick-empty">{{ t('beanManager.batchesFailed') }}</div>
      <div v-else-if="!batches.length" class="pick-empty">{{ t('beanManager.noBatches') }}</div>
    </div>

    <!-- Same style and position as the wizard's BatchPicker.vue / BeanChooser's
         "+ New ___" — a .btn, bottom left. -->
    <div class="prep-bottom">
      <button class="btn" @click="openAddBatch">+ {{ t('beanManager.addBatch') }}</button>
    </div>

    <RoastDatePicker
      v-if="showRoastPicker"
      :model-value="roastPickerTarget?.roastDate ?? null"
      @confirm="onRoastConfirm"
      @cancel="showRoastPicker = false"
    />
  </div>
</template>
