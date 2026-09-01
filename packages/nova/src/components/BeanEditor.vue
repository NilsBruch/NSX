<script setup>
/**
 * Bean detail — create/edit/archive/delete. Roast date deliberately lives on
 * the recipe's batch (see useRecipe.js), not here: a bean's roaster/origin/
 * variety/process are permanent, what changes is which bag you're pulling
 * from right now.
 */
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openTextField, openConfirm } from '../composables/useModals.js';
import { recipesUsingBean, deleteRecipesUsingBean, refreshRecipes } from '../composables/useRecipe.js';

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

// Every bean's raw value for a field, as a display string.
function rawValuesFor(field) {
  const beans = NSXCore.getBeans() || [];
  const vals = [];
  for (const b of beans) {
    const raw = field === 'variety'
      ? (Array.isArray(b?.variety) ? b.variety.join(', ') : b?.variety)
      : b?.[field];
    const val = String(raw ?? '').trim();
    if (val) vals.push(val);
  }
  return vals;
}

// Distinct existing values for a bean field, pulled from every bean already in
// the library — surfaced as tap-to-fill suggestions so the same roaster/name
// isn't re-spelled slightly differently each time.
function suggestionsFor(field) {
  return [...new Set(rawValuesFor(field))].sort((a, b) => a.localeCompare(b));
}

/**
 * Per-ENTRY suggestions for the list fields. Two beans practically never share
 * a whole combination ("blueberry, dark chocolate, cane sugar", or a blend's
 * "Ethiopia, Brazil"), but they very much share the individual entries — so
 * suggesting whole strings off other beans almost never produced a usable hit.
 * Split every bean's value on commas and suggest the individual entries, which
 * the tag field then lets the user reassemble by tapping.
 */
function entrySuggestionsFor(field) {
  const seen = new Map(); // lowercase -> first-seen casing, so chips stay consistent
  for (const raw of rawValuesFor(field)) {
    for (const part of raw.split(',')) {
      const val = part.trim();
      if (val && !seen.has(val.toLowerCase())) seen.set(val.toLowerCase(), val);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
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
 * Deleting a bean used to happen on the tap, with no confirmation and no
 * regard for what pointed at it. Both are fixed here.
 *
 * The bridge CASCADES: deleting a bean deletes its batches. Past shots are not
 * touched and keep their ratings and notes, but the batch id they carry is now
 * dangling — useDiary's shotMatchesBean falls through to roaster/name matching,
 * and with the bean gone they simply group under no bean, staying visible in
 * the flat History. That is unavoidable once the bean is deleted, so the
 * dialog says it rather than pretending otherwise.
 *
 * Recipes cascade with the bean, the way the bridge's batches do: deleting a
 * coffee means it is gone, and a recipe for a coffee you no longer have is
 * clutter. The count is named in the confirmation because it is the part that
 * is NOT obvious — a recipe carries the grind, dose, yield, temperature,
 * profile, rating and the volume calibration learned over many shots, and all
 * of that goes with it. Archiving the bean instead keeps everything, which is
 * why the dialog points at it.
 */
async function del() {
  // Re-read the library first: the count is what the user decides on, so it
  // must not come from a cache another device may have moved on from.
  await refreshRecipes().catch(() => { /* fall back to what's cached */ });
  const affected = recipesUsingBean(props.bean);

  const ok = await openConfirm({
    title: affected.length
      ? t('diary.deleteBeanAndRecipes', { n: affected.length }, affected.length)
      : t('diary.deleteBeanConfirm'),
    message: t('diary.deleteBeanArchiveHint'),
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (!ok) return;

  // Recipes first: if the gateway then refuses the bean, nothing is left
  // pointing at a bean that is still there but no longer referenced.
  if (affected.length) await deleteRecipesUsingBean(props.bean);
  await NSXCore.deleteBean(props.bean.id);
  await NSXCore.loadBeans();
  emit('deleted');
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
