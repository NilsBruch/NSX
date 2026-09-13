<script setup>
/**
 * Beans, managed from Settings rather than only browsed from the Diary — a
 * master-detail layout mirroring ProfilePicker.vue's own manage mode: beans
 * grouped by roaster on the left (same flat group/item `entries` technique),
 * the selected bean's whole record as read-only cards on the right (reusing
 * BeanEditor's own .bfield card and its diary.* labels, so this pane and the
 * editor one tap away never say two different things about the same field),
 * then that bean's batches (bags) below with their own Add / Edit-date /
 * Delete actions.
 *
 * The cards are deliberately read-only — editing goes through the SAME
 * BeanEditor.vue the Diary opens, so there is exactly one place bean fields
 * are actually written. Archive/Delete for the bean itself also live in
 * BeanEditor already; this pane's own actions are Delete/Archive/Edit,
 * matching ProfilePicker's manage-mode action row.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { beans, formatShortDate } from '../../composables/useCore.js';
import {
  toggleArchiveBean, confirmAndDeleteBean,
  addBatch, setBatchRoastDate, confirmAndDeleteBatch,
} from '../../composables/useBeanActions.js';
import BeanEditor from '../BeanEditor.vue';
import RoastDatePicker from '../RoastDatePicker.vue';

defineEmits(['close']);
const { t } = useI18n();
const { NSXCore, NSXApi } = window;

// ── Left list: grouped by roaster — same flat-entries technique as
// ProfilePicker.vue's `entries` (group headers, then members, one sorted
// pass), so beans read the same way profiles already do in this skin. ──
const entries = computed(() => {
  const groups = new Map();
  for (const bean of beans.value) {
    const key = bean.roaster || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bean);
  }
  const locale = window.NSXI18n?.getLocale?.() ?? 'en-US';
  const sortable = [...groups.entries()].map(([roaster, members]) => ({
    sortKey: roaster,
    rows: [
      { kind: 'group', id: `group:${roaster}`, label: roaster },
      ...members
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), locale))
        .map((bean) => ({ kind: 'item', id: bean.id, bean })),
    ],
  }));
  sortable.sort((a, b) => a.sortKey.localeCompare(b.sortKey, locale));
  return sortable.flatMap((s) => s.rows);
});

const selectedId = ref(null);
const selected = computed(() => beans.value.find((b) => b.id === selectedId.value) ?? null);

// The next (else previous) bean after `id` in the on-screen list — read
// BEFORE a delete takes effect, same reasoning as ProfilePicker's own
// neighborId (its comment: "entries still contains the about-to-be-removed
// record at that point"). Archive does NOT need this: the bean stays in
// `entries` either way (no archived filter on the list), just muted.
function neighborId(id) {
  const items = entries.value.filter((e) => e.kind === 'item');
  const idx = items.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  return (items[idx + 1] ?? items[idx - 1] ?? null)?.id ?? null;
}

const varietyText = computed(() => (Array.isArray(selected.value?.variety) ? selected.value.variety.join(', ') : (selected.value?.variety || '')));
const altMin = computed(() => selected.value?.altitude?.[0] ?? '');
const altMax = computed(() => selected.value?.altitude?.[1] ?? '');

// ── Bean actions ──
const showEditor = ref(false);
const editingBean = ref(null); // null = new bean
function openNewBean() { editingBean.value = null; showEditor.value = true; }
function openEditBean() { editingBean.value = selected.value; showEditor.value = true; }
function closeEditor() { showEditor.value = false; editingBean.value = null; }
// BeanEditor hands back the freshly-reloaded record on save (its own
// loadBeans() already ran) — landing the new/edited bean selected is free,
// the selectedId-keyed `selected` computed above just re-resolves.
function onEditorSaved(bean) {
  selectedId.value = bean?.id ?? selectedId.value;
  closeEditor();
}
// BeanEditor's own Delete button already ran confirmAndDeleteBean by the time
// this fires — nothing left to confirm, just clear the now-gone selection.
function onEditorDeleted() {
  selectedId.value = null;
  closeEditor();
}

async function archiveSelected() {
  if (selected.value) await toggleArchiveBean(selected.value);
}
async function deleteSelected() {
  const record = selected.value;
  if (!record) return;
  const fallback = neighborId(record.id);
  if (await confirmAndDeleteBean(record)) selectedId.value = fallback;
}

// ── Batches: fetched per selected bean. No reactive store for these
// anywhere in nova, and fetchBatches carries no ETag layer, so every
// selection is a real round trip — see useBeanActions.js for why this
// isn't backed by nova's shared `shots`-style cache instead. ──
const batches = ref([]);
const batchesLoading = ref(false);
const batchesFailed = ref(false);
let batchReq = 0; // race guard — same pattern as RecipeBrowser.vue's reqId

async function loadBatches(beanId) {
  const my = ++batchReq;
  if (!beanId) { batches.value = []; batchesLoading.value = false; return; }
  batchesLoading.value = true;
  batchesFailed.value = false;
  try {
    const res = await NSXApi.fetchBatches(beanId, true);
    if (my !== batchReq) return; // a newer selection already won
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
// Watches the id, not `selected` itself: `selected` is a computed over
// `beans.value`, which loadBeans() replaces wholesale on every bean save —
// watching it would re-fetch the bag list after every unrelated bean edit.
watch(selectedId, (id) => loadBatches(id), { immediate: true });

// ── Batch actions ──
const showRoastPicker = ref(false);
const roastPickerTarget = ref(null); // existing batch being edited, or null = adding
function openAddBatch() { roastPickerTarget.value = null; showRoastPicker.value = true; }
function openEditBatch(batch) { roastPickerTarget.value = batch; showRoastPicker.value = true; }
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
  else if (selected.value) await addBatch(selected.value.id, iso);
  await loadBatches(selectedId.value);
}
async function deleteBatchRow(batch) {
  if (await confirmAndDeleteBatch(batch)) await loadBatches(selectedId.value);
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ t('settingsPage.beans') }}</span>
      <button class="sort-btn lg" @click="openNewBean">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        {{ t('diary.newBean') }}
      </button>
    </div>

    <div class="pick-body">
      <div class="pick-list">
        <div class="pick-items bean-list-items">
          <template v-for="e in entries" :key="e.id">
            <span v-if="e.kind === 'group'" class="pick-group-label">{{ e.label }}</span>
            <button
              v-else
              class="pick-item"
              :class="{ sel: e.bean.id === selectedId, grouped: true, 'is-hidden': e.bean.archived }"
              @click="selectedId = e.bean.id"
            >
              <span class="pname">{{ e.bean.name || '—' }}</span>
            </button>
          </template>
          <div v-if="!entries.length" class="pick-empty">{{ t('beanManager.noBeans') }}</div>
        </div>
      </div>

      <div v-if="selected" class="pick-detail">
        <div class="pd-title">{{ selected.roaster || '—' }} – {{ selected.name || '—' }}</div>

        <div class="bean-fields">
          <div class="bfield"><span class="bl">{{ t('diary.roaster') }}</span><span class="bv" :class="{ empty: !selected.roaster }">{{ selected.roaster || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.name') }}</span><span class="bv" :class="{ empty: !selected.name }">{{ selected.name || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.species') }}</span><span class="bv" :class="{ empty: !selected.species }">{{ selected.species || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.country') }}</span><span class="bv" :class="{ empty: !selected.country }">{{ selected.country || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.region') }}</span><span class="bv" :class="{ empty: !selected.region }">{{ selected.region || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.producer') }}</span><span class="bv" :class="{ empty: !selected.producer }">{{ selected.producer || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.variety') }}</span><span class="bv" :class="{ empty: !varietyText }">{{ varietyText || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.processing') }}</span><span class="bv" :class="{ empty: !selected.processing }">{{ selected.processing || t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.altFrom') }}</span><span class="bv" :class="{ empty: altMin === '' }">{{ altMin !== '' ? altMin : t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.altTo') }}</span><span class="bv" :class="{ empty: altMax === '' }">{{ altMax !== '' ? altMax : t('diary.empty') }}</span></div>
          <div class="bfield"><span class="bl">{{ t('diary.decaf') }}</span><span class="bv">{{ selected.decaf ? t('common.yes') : t('common.no') }}</span></div>
          <div v-if="selected.decaf" class="bfield"><span class="bl">{{ t('diary.decafProcess') }}</span><span class="bv" :class="{ empty: !selected.decafProcess }">{{ selected.decafProcess || t('diary.empty') }}</span></div>
          <div class="bfield full"><span class="bl">{{ t('diary.notes') }}</span><span class="bv" :class="{ empty: !selected.notes }">{{ selected.notes || t('diary.empty') }}</span></div>
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

        <div class="pd-actions">
          <button class="btn danger" @click="deleteSelected">{{ t('common.delete') }}</button>
          <button class="btn" @click="archiveSelected">{{ selected.archived ? t('diary.unarchive') : t('diary.archive') }}</button>
          <button class="btn accent" @click="openEditBean">{{ t('common.edit') }}</button>
        </div>
      </div>
    </div>

    <BeanEditor v-if="showEditor" :bean="editingBean" @close="closeEditor" @saved="onEditorSaved" @deleted="onEditorDeleted" />
    <RoastDatePicker
      v-if="showRoastPicker"
      :model-value="roastPickerTarget?.roastDate ?? null"
      @confirm="onRoastConfirm"
      @cancel="showRoastPicker = false"
    />
  </div>
</template>
