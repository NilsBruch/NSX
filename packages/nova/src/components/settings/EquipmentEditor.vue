<script setup>
/**
 * A piece of kit — scale, tamper, WDT tool, kettle. DYE2's `equipment[]` row
 * is deliberately thin: a name, plus `custom`, a list of fields the user
 * names themselves ("Weight: 250g", "Burr size: 64mm"). There is no fixed
 * schema for those, so the editor can only offer key/value pairs — which is
 * also why they're rendered as rows rather than a form.
 */
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openTextField, openConfirm } from '../../composables/useModals.js';

const props = defineProps({
  item: { type: Object, default: null }, // null = new item
});
const emit = defineEmits(['close', 'saved', 'deleted']);
const { t } = useI18n();
const { NSXCore } = window;

const isNew = !props.item;
const draft = reactive({
  name: props.item?.name ?? '',
  // Read through core, which tolerates the older rows that have no `custom`
  // at all and the arbitrary shapes the contract permits inside it.
  custom: NSXCore.getCustomFields(props.item),
});

async function editName() {
  const v = await openTextField({ title: t('equipmentEditor.name'), value: draft.name });
  if (v != null) draft.name = v;
}
async function editValue(i) {
  const v = await openTextField({ title: draft.custom[i].key, value: draft.custom[i].value });
  if (v != null) draft.custom[i].value = v;
}
async function addField() {
  const key = await openTextField({ title: t('equipmentEditor.fieldName') });
  if (!key || !key.trim()) return;
  draft.custom.push({ key: key.trim(), value: '' });
}
function removeField(i) {
  draft.custom.splice(i, 1);
}

const saving = ref(false);

async function save() {
  if (saving.value || !draft.name.trim()) return;
  saving.value = true;
  try {
    await NSXCore.saveEquipmentItem({
      ...(props.item ?? {}),
      name: draft.name.trim(),
      custom: NSXCore.normalizeCustomFields(draft.custom),
    });
    await NSXCore.loadEquipmentLibrary();
    emit('saved');
  } finally {
    saving.value = false;
  }
}

async function del() {
  const ok = await openConfirm({
    title: t('equipmentEditor.deleteConfirm', { name: draft.name || '—' }),
    message: t('equipmentEditor.deleteHint'),
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (!ok) return;
  await NSXCore.deleteEquipmentItem(props.item.id);
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
      <span class="ov-title">{{ isNew ? t('equipmentEditor.newTitle') : (draft.name || '—') }}</span>
    </div>

    <div class="settings-scroll">
      <span class="setting-group-label">{{ t('settingsPage.otherEquipment') }}</span>
      <button class="setting-row as-btn" @click="editName">
        <span class="sr-name">{{ t('equipmentEditor.name') }}</span>
        <span class="sr-value" :class="{ muted: !draft.name }">{{ draft.name || t('common.notSet') }}<span class="sr-chev">›</span></span>
      </button>

      <span class="setting-group-label">{{ t('equipmentEditor.fields') }}</span>
      <!-- The row itself edits the value; the trailing × drops the whole
           field, since a field the user named is only removable as a pair. -->
      <div v-for="(f, i) in draft.custom" :key="i" class="setting-row eq-field">
        <button class="eq-field-main" @click="editValue(i)">
          <span class="sr-name">{{ f.key }}</span>
          <span class="sr-value" :class="{ muted: !f.value }">{{ f.value || t('common.notSet') }}<span class="sr-chev">›</span></span>
        </button>
        <button class="eq-field-del" :aria-label="t('common.delete')" @click="removeField(i)">×</button>
      </div>
      <button class="setting-row as-btn eq-add" @click="addField">
        <span class="sr-name">{{ t('equipmentEditor.addField') }}</span>
        <span class="sr-value">+</span>
      </button>
      <p v-if="!draft.custom.length" class="eq-hint">{{ t('equipmentEditor.fieldsHint') }}</p>
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
