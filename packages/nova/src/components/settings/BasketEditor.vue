<script setup>
/**
 * Filter-basket detail — create/edit/delete. Fields are exactly the ones
 * DYE2's KV contract defines for a `baskets[]` row (name/size/diameterMm/
 * notes), because the row is written back into DYE2's own namespace and both
 * sides have to read it.
 */
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openTextField, openChooser, openNumberPad, openConfirm } from '../../composables/useModals.js';

const props = defineProps({
  basket: { type: Object, default: null }, // null = new basket
});
const emit = defineEmits(['close', 'saved', 'deleted']);
const { t } = useI18n();
const { NSXCore } = window;

const isNew = !props.basket;
const draft = reactive({
  name: props.basket?.name ?? '',
  size: props.basket?.size ?? '',
  diameterMm: props.basket?.diameterMm ?? '',
  notes: props.basket?.notes ?? '',
});

// The contract's fixed vocabulary — a free-text size would not round-trip
// into DYE2's own size filter.
const sizeOpts = [
  ['single', t('basketEditor.single')],
  ['double', t('basketEditor.double')],
  ['triple', t('basketEditor.triple')],
  ['bottomless', t('basketEditor.bottomless')],
  ['other', t('basketEditor.other')],
];
const sizeLabel = (v) => sizeOpts.find(([value]) => value === v)?.[1] ?? '';

async function editText(field, label) {
  const v = await openTextField({ title: label, value: String(draft[field] ?? '') });
  if (v != null) draft[field] = v;
}
async function pickSize() {
  const v = await openChooser({ title: t('basketEditor.size'), options: sizeOpts, current: draft.size });
  if (v != null) draft.size = v;
}
async function editDiameter() {
  const v = await openNumberPad({ title: t('basketEditor.diameter'), unit: 'mm', value: draft.diameterMm ?? '' });
  if (v != null) draft.diameterMm = v;
}

// Same guard as GrinderEditor: without it a save that stalls leaves the
// button live and every further tap appends ANOTHER row to the array.
const saving = ref(false);

async function save() {
  if (saving.value || !draft.name.trim()) return;
  saving.value = true;
  try {
    await NSXCore.saveBasket({
      ...(props.basket ?? {}),
      name: draft.name.trim(),
      size: draft.size,
      diameterMm: draft.diameterMm !== '' ? Number(draft.diameterMm) : null,
      notes: draft.notes,
    });
    await NSXCore.loadEquipmentLibrary();
    emit('saved');
  } finally {
    saving.value = false;
  }
}

async function del() {
  const ok = await openConfirm({
    title: t('basketEditor.deleteConfirm', { name: draft.name || '—' }),
    message: t('basketEditor.deleteHint'),
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (!ok) return;
  await NSXCore.deleteBasket(props.basket.id);
  await NSXCore.loadEquipmentLibrary();
  emit('deleted');
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.equipment') }}
      </button>
      <span class="ov-title">{{ isNew ? t('basketEditor.newTitle') : (draft.name || '—') }}</span>
    </div>

    <div class="settings-scroll">
      <span class="setting-group-label">{{ t('settingsPage.baskets') }}</span>
      <button class="setting-row as-btn" @click="editText('name', t('basketEditor.name'))">
        <span class="sr-name">{{ t('basketEditor.name') }}</span>
        <span class="sr-value" :class="{ muted: !draft.name }">{{ draft.name || t('common.notSet') }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="pickSize">
        <span class="sr-name">{{ t('basketEditor.size') }}</span>
        <span class="sr-value" :class="{ muted: !draft.size }">{{ sizeLabel(draft.size) || t('common.notSet') }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="editDiameter">
        <span class="sr-name">{{ t('basketEditor.diameter') }}</span>
        <span class="sr-value" :class="{ muted: draft.diameterMm === '' || draft.diameterMm == null }">{{ draft.diameterMm !== '' && draft.diameterMm != null ? `${draft.diameterMm} mm` : t('common.notSet') }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="editText('notes', t('basketEditor.notes'))">
        <span class="sr-name">{{ t('basketEditor.notes') }}</span>
        <span class="sr-value" :class="{ muted: !draft.notes }">{{ draft.notes || t('common.notSet') }}<span class="sr-chev">›</span></span>
      </button>
    </div>

    <div class="bean-actions">
      <template v-if="isNew">
        <button class="act-btn grow" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="act-btn accent grow" :disabled="saving || !draft.name.trim()" @click="save">{{ t('common.save') }}</button>
      </template>
      <template v-else>
        <button class="act-btn danger grow" @click="del">{{ t('common.delete') }}</button>
        <button class="act-btn accent grow" :disabled="saving || !draft.name.trim()" @click="save">{{ t('common.save') }}</button>
      </template>
    </div>
  </div>
</template>
