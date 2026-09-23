<script setup>
/**
 * A list you pick from. Single by default — tapping an item IS the answer, so
 * there is no confirm button. In `multi` mode (openMultiChooser) a tap toggles
 * instead and Done closes it, because "none" and "not finished yet" look the
 * same without one.
 */
import { useI18n } from 'vue-i18n';
import { chooserState, resolveChooser } from '../composables/useModals.js';

const { t } = useI18n();
const cancel = () => resolveChooser(null);

const isPicked = (value) => chooserState.picked.includes(value);
function toggle(value) {
  const i = chooserState.picked.indexOf(value);
  // Appended, not sorted into the options' order: the order you tick them in
  // is the order they read back in, which is the only order that means
  // anything for a list of kit.
  if (i >= 0) chooserState.picked.splice(i, 1);
  else chooserState.picked.push(value);
}
</script>

<template>
  <div v-if="chooserState.open" class="scrim" @click.self="cancel">
    <div class="modal">
      <span class="m-title">{{ chooserState.title }}</span>
      <div class="chooser">
        <button
          v-for="[value, label] in chooserState.options"
          :key="value"
          class="chooser-item"
          :class="chooserState.multi ? { sel: isPicked(value) } : { sel: value === chooserState.current }"
          @click="chooserState.multi ? toggle(value) : resolveChooser(value)"
        >
          <span v-if="chooserState.multi" class="ch-tick">{{ isPicked(value) ? '✓' : '' }}</span>{{ label }}
        </button>
      </div>
      <div class="modal-actions">
        <button class="cancel" @click="cancel">{{ t('common.cancel') }}</button>
        <button v-if="chooserState.multi" class="confirm" @click="resolveChooser([...chooserState.picked])">
          {{ t('common.done') }}
        </button>
      </div>
    </div>
  </div>
</template>
