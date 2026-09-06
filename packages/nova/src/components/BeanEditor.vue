<script setup>
/**
 * Bean detail — create/edit/archive/delete. Roast date deliberately lives on
 * the recipe's batch (see useRecipe.js), not here: a bean's roaster/origin/
 * variety/process are permanent, what changes is which bag you're pulling
 * from right now.
 */
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openTextField } from '../composables/useModals.js';
import { confirmAndDeleteBean } from '../composables/useBeanActions.js';

const props = defineProps({
  bean: { type: Object, default: null }, // null = new bean
  presetRoaster: { type: String, default: '' },
});
const emit = defineEmits(['close', 'saved', 'deleted']);
const { t } = useI18n();
const { NSXCore } = window;

const isNew = !props.bean;
const draft = reactive({
  roaster: props.bean?.roaster ?? props.presetRoaster,
  name: props.bean?.name ?? '',
  country: props.bean?.country ?? '',
  region: props.bean?.region ?? '',
  producer: props.bean?.producer ?? '',
  species: props.bean?.species ?? '',
  variety: Array.isArray(props.bean?.variety) ? props.bean.variety.join(', ') : (props.bean?.variety ?? ''),
  processing: props.bean?.processing ?? '',
  altMin: props.bean?.altitude?.[0] ?? '',
  altMax: props.bean?.altitude?.[1] ?? '',
  decaf: !!props.bean?.decaf,
  decafProcess: props.bean?.decafProcess ?? '',
  notes: props.bean?.notes ?? '',
  archived: !!props.bean?.archived,
});

const showMore = ref(false);

/**
 * Fields that hold a LIST rather than one value: a blend has several origins,
 * varieties, producers and processes, and tasting notes are a list by nature.
 * These open as a tag field — each entry is its own chip, commas are written
 * for the user — and their suggestions are split per entry (see below).
 * `variety` is already an array in the bean record; the rest stay
 * comma-separated strings, which is what they always were.
 */
const LIST_FIELDS = new Set(['country', 'region', 'producer', 'species', 'variety', 'processing', 'notes']);

// Distinct existing values for a bean field, pulled from every bean already in
// the library — surfaced as tap-to-fill suggestions so the same roaster/name
// isn't re-spelled slightly differently each time. Newest bean first
// (NSXCore.uniqueFieldValuesByRecency, keyed off each bean's createdAt) rather
// than alphabetical — the roaster you just typed for a previous bean is what
// you want to tap again, not whichever one starts with an early letter. Folds
// case variants together (first occurrence, which is now the most recent
// bean's casing) so near-duplicate spellings still collapse into one chip.
function suggestionsFor(field) {
  return dedupeCaseInsensitive(NSXCore.uniqueFieldValuesByRecency(NSXCore.getBeans(), field));
}

/**
 * Per-ENTRY suggestions for the list fields. Two beans practically never share
 * a whole combination ("blueberry, dark chocolate, cane sugar", or a blend's
 * "Ethiopia, Brazil"), but they very much share the individual entries — so
 * suggesting whole strings off other beans almost never produced a usable hit.
 * `pick` here returns the SPLIT entries (or, for `variety`, the array it
 * already is) so uniqueFieldValuesByRecency's per-item array handling ranks
 * each entry by its own bean's createdAt, not the whole field's.
 */
function entrySuggestionsFor(field) {
  const pick = (b) => {
    const raw = field === 'variety' ? (Array.isArray(b?.variety) ? b.variety : []) : String(b?.[field] ?? '').split(',');
    return raw.map((v) => String(v).trim()).filter(Boolean);
  };
  return dedupeCaseInsensitive(NSXCore.uniqueFieldValuesByRecency(NSXCore.getBeans(), pick));
}

// uniqueFieldValuesByRecency dedupes on exact string equality; these fields
// have historically allowed inconsistent casing ("Ethiopia" / "ethiopia"),
// so fold case variants together on top of it, keeping whichever casing is
// first in the (already recency-ordered) list.
function dedupeCaseInsensitive(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

async function editField(field, label, type = 'text') {
  // Numeric fields (altitude) have no meaningful text suggestions.
  const isNumber = type === 'number';
  const isList = !isNumber && LIST_FIELDS.has(field);
  const v = await openTextField({
    title: label,
    value: String(draft[field] ?? ''),
    type,
    tags: isList, // type + ↵ or tap a suggestion; commas are written for the user
    placeholder: isList ? t('textField.tagHint') : '',
    suggestions: isNumber ? [] : (isList ? entrySuggestionsFor(field) : suggestionsFor(field)),
  });
  if (v == null) return;
  draft[field] = v;
}

function toPayload() {
  return {
    roaster: draft.roaster, name: draft.name, country: draft.country, region: draft.region,
    producer: draft.producer, species: draft.species,
    variety: draft.variety ? draft.variety.split(',').map((v) => v.trim()).filter(Boolean) : [],
    processing: draft.processing,
    altitude: (draft.altMin !== '' || draft.altMax !== '') ? [Number(draft.altMin) || null, Number(draft.altMax) || null] : undefined,
    decaf: draft.decaf, decafProcess: draft.decaf ? draft.decafProcess : '',
    notes: draft.notes, archived: draft.archived,
  };
}

async function save() {
  const payload = toPayload();
  const saved = isNew
    ? await NSXCore.createBean(payload)
    : await NSXCore.updateBean(props.bean.id, payload);
  await NSXCore.loadBeans();
  // Emit the saved bean so a caller mid-flow (the new-recipe bean step) can carry
  // straight on with it instead of having to hunt it back out of the list.
  const id = saved?.id ?? props.bean?.id;
  emit('saved', NSXCore.getBeans().find((b) => b.id === id) ?? saved);
}

async function toggleArchive() {
  draft.archived = !draft.archived;
  await NSXCore.updateBean(props.bean.id, toPayload());
  await NSXCore.loadBeans();
}

/**
 * Delete lives in useBeanActions so the Diary's own row menu runs the exact
 * same sequence — see there for why it is more than a DELETE call.
 */
async function del() {
  if (await confirmAndDeleteBean(props.bean)) emit('deleted');
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('diary.back') }}
      </button>
      <span class="ov-title">{{ isNew ? t('diary.newBean') : `${draft.roaster || '—'} – ${draft.name || '—'}` }}</span>
    </div>

    <div class="bean-fields">
      <button class="bfield" @click="editField('roaster', t('diary.roaster'))">
        <span class="bl">{{ t('diary.roaster') }}</span><span class="bv" :class="{ empty: !draft.roaster }">{{ draft.roaster || t('diary.empty') }}</span>
      </button>
      <button class="bfield" @click="editField('name', t('diary.name'))">
        <span class="bl">{{ t('diary.name') }}</span><span class="bv" :class="{ empty: !draft.name }">{{ draft.name || t('diary.empty') }}</span>
      </button>
      <button class="bfield" @click="editField('country', t('diary.country'))">
        <span class="bl">{{ t('diary.country') }}</span><span class="bv" :class="{ empty: !draft.country }">{{ draft.country || t('diary.empty') }}</span>
      </button>
      <button class="bfield" @click="editField('variety', t('diary.variety'))">
        <span class="bl">{{ t('diary.variety') }}</span><span class="bv" :class="{ empty: !draft.variety }">{{ draft.variety || t('diary.empty') }}</span>
      </button>
      <button class="bfield" @click="editField('processing', t('diary.processing'))">
        <span class="bl">{{ t('diary.processing') }}</span><span class="bv" :class="{ empty: !draft.processing }">{{ draft.processing || t('diary.empty') }}</span>
      </button>
      <button class="bfield" @click="editField('notes', t('diary.notes'))">
        <span class="bl">{{ t('diary.notes') }}</span><span class="bv" :class="{ empty: !draft.notes }">{{ draft.notes || t('diary.empty') }}</span>
      </button>

      <template v-if="showMore">
        <button class="bfield" @click="editField('region', t('diary.region'))">
          <span class="bl">{{ t('diary.region') }}</span><span class="bv" :class="{ empty: !draft.region }">{{ draft.region || t('diary.empty') }}</span>
        </button>
        <button class="bfield" @click="editField('producer', t('diary.producer'))">
          <span class="bl">{{ t('diary.producer') }}</span><span class="bv" :class="{ empty: !draft.producer }">{{ draft.producer || t('diary.empty') }}</span>
        </button>
        <button class="bfield" @click="editField('species', t('diary.species'))">
          <span class="bl">{{ t('diary.species') }}</span><span class="bv" :class="{ empty: !draft.species }">{{ draft.species || t('diary.empty') }}</span>
        </button>
        <button class="bfield" @click="editField('altMin', t('diary.altFrom'), 'number')">
          <span class="bl">{{ t('diary.altFrom') }}</span><span class="bv" :class="{ empty: draft.altMin === '' }">{{ draft.altMin !== '' ? draft.altMin : t('diary.empty') }}</span>
        </button>
        <button class="bfield" @click="editField('altMax', t('diary.altTo'), 'number')">
          <span class="bl">{{ t('diary.altTo') }}</span><span class="bv" :class="{ empty: draft.altMax === '' }">{{ draft.altMax !== '' ? draft.altMax : t('diary.empty') }}</span>
        </button>
        <button class="bfield" @click="draft.decaf = !draft.decaf">
          <span class="bl">{{ t('diary.decaf') }}</span><span class="bv">{{ draft.decaf ? t('common.yes') : t('common.no') }}</span>
        </button>
        <button v-if="draft.decaf" class="bfield" @click="editField('decafProcess', t('diary.decafProcess'))">
          <span class="bl">{{ t('diary.decafProcess') }}</span><span class="bv" :class="{ empty: !draft.decafProcess }">{{ draft.decafProcess || t('diary.empty') }}</span>
        </button>
      </template>

      <button class="more-btn" @click="showMore = !showMore">{{ showMore ? t('diary.fewerFields') : t('diary.moreFields') }}</button>
    </div>

    <div class="bean-actions">
      <template v-if="isNew">
        <button class="act-btn grow" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="act-btn accent grow" @click="save">{{ t('common.save') }}</button>
      </template>
      <template v-else>
        <button class="act-btn grow" @click="toggleArchive">{{ draft.archived ? t('diary.unarchive') : t('diary.archive') }}</button>
        <button class="act-btn danger" @click="del">{{ t('common.delete') }}</button>
        <button class="act-btn accent" @click="save">{{ t('common.save') }}</button>
      </template>
    </div>
  </div>
</template>
