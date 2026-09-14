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
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatShortDate } from '../composables/useCore.js';
import { addBatch, setBatchRoastDate, confirmAndDeleteBatch } from '../composables/useBeanActions.js';
import RoastDatePicker from './RoastDatePicker.vue';

const props = defineProps({
  bean: { type: Object, required: true },
});
defineEmits(['close']);
const { t } = useI18n();
const { NSXCore, NSXApi } = window;

// ── Batches: fetched for this one bean. No reactive store for these
// anywhere in nova, and fetchBatches carries no ETag layer, so this is
// always a real round trip — see useBeanActions.js for why this isn't backed
// by nova's shared `shots`-style cache instead. ──
const batches = ref([]);
const batchesLoading = ref(false);
const batchesFailed = ref(false);
let batchReq = 0; // race guard — same pattern as RecipeBrowser.vue's reqId

async function loadBatches() {
  const beanId = props.bean?.id;
  const my = ++batchReq;
  if (!beanId) { batches.value = []; batchesLoading.value = false; return; }
  batchesLoading.value = true;
  batchesFailed.value = false;
  try {
    const res = await NSXApi.fetchBatches(beanId, true);
    if (my !== batchReq) return; // a newer load already won
    const list = Array.isArray(res) ? res : (res?.items ?? []);
    batches.value = list.slice().sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')));
  } catch (err) {
    if (my !== batchReq) return;
    console.warn('[Nova] could not load this bean\'s bags', err?.message);
    batches.value = [];
    batchesFailed.value = true;
  } finally {
    if (my === batchReq) batchesLoading.value = false;
  }
}
// The panel is mounted fresh per bean (v-if in the Diary), so a plain call is
// enough — no prop to watch for a bean swap under it.
loadBatches();

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
  await loadBatches();
}
async function deleteBatchRow(batch) {
  if (await confirmAndDeleteBatch(batch)) await loadBatches();
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

    <div class="bm-batches-head">
      <span class="pd-panel-label">{{ t('beanManager.batches') }}</span>
      <button class="sort-btn icon-only accent" :aria-label="t('beanManager.addBatch')" @click="openAddBatch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
    </div>
    <div class="pd-stages-list">
      <div v-for="b in batches" :key="b.id" class="pd-stage batch-row">
        <div class="pd-stage-main">
          <span class="pd-stage-name">{{ b.roastDate ? formatShortDate(b.roastDate) : t('diary.empty') }}</span>
          <span class="pd-stage-detail">{{ b.roastDate ? NSXCore.getBatchAge(b.roastDate) : '' }}<template v-if="b.archived"> · {{ t('diary.archive') }}</template></span>
        </div>
        <div class="batch-row-actions">
          <button :aria-label="t('common.edit')" @click="openEditBatch(b)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2.5a2.121 2.121 0 0 1 3 3L6 17l-4 1 1-4 11.5-11.5z" /></svg>
          </button>
          <button class="danger" :aria-label="t('common.delete')" @click="deleteBatchRow(b)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" /></svg>
          </button>
        </div>
      </div>
      <div v-if="batchesLoading" class="pick-empty">{{ t('diary.loading') }}</div>
      <div v-else-if="batchesFailed" class="pick-empty">{{ t('beanManager.batchesFailed') }}</div>
      <div v-else-if="!batches.length" class="pick-empty">{{ t('beanManager.noBatches') }}</div>
    </div>

    <RoastDatePicker
      v-if="showRoastPicker"
      :model-value="roastPickerTarget?.roastDate ?? null"
      @confirm="onRoastConfirm"
      @cancel="showRoastPicker = false"
    />
  </div>
</template>
