<script setup>
/**
 * The recipe wizard's own bag-picking step (RecipePicker.vue), right after
 * Bean and before Grinder/Profile — which bag you're brewing from is a
 * property of the bean, not something to settle after the rest of the
 * recipe is composed. Same list as BagsPanel.vue's (the Diary's own bag
 * manager) via the shared useBeanBatches — dated AND undated bags both
 * shown, exactly as they are there — but rows are tappable to SELECT rather
 * than carrying Edit/Delete: this screen picks a bag, it doesn't manage one.
 * "Add new" opens the same RoastDatePicker and resolves through
 * NSXCore.resolveBatch (find-or-create), so confirming a date that already
 * has a bag joins it instead of creating a duplicate.
 *
 * Header and bottom-bar structure mirror BeanChooser.vue exactly (crumbs
 * slot + the invisible width-reserving button so the bubbles don't shift
 * sideways between wizard screens; "+ New ___" as a .btn in .prep-bottom,
 * not a header icon) — same wizard, same screen language.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatShortDate } from '../composables/useCore.js';
import { useBeanBatches } from '../composables/useBeanBatches.js';
import RoastDatePicker from './RoastDatePicker.vue';

const props = defineProps({
  bean: { type: Object, required: true },
});
const emit = defineEmits(['pick', 'back']);
const { t } = useI18n();
const { NSXCore } = window;

const { batches, loading, failed, load } = useBeanBatches();
load(props.bean?.id);

function pickExisting(b) {
  emit('pick', { id: b.id, roastDate: b.roastDate ?? null });
}

const showRoastPicker = ref(false);
function openAddNew() { showRoastPicker.value = true; }
async function onRoastConfirm(iso) {
  showRoastPicker.value = false;
  const batch = await NSXCore.resolveBatch(props.bean.id, iso);
  emit('pick', { id: batch?.id ?? null, roastDate: iso });
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <!-- The wizard puts its progress bubbles here, on the header's own row —
           same slot BeanChooser/ProfilePicker take theirs through. -->
      <slot name="crumbs"><span class="ov-title">{{ t('beanManager.batches') }}</span></slot>
      <!-- Reserves exactly the width of the OTHER wizard screens' trailing
           header buttons, so the progress bubbles sit in the same place on
           every screen instead of jumping sideways as the wizard advances —
           this screen's own "+" moved down to .prep-bottom, so without this
           its header would be narrower than its neighbours'. -->
      <span v-if="$slots.crumbs" class="sort-btn lg icon-only" aria-hidden="true" style="visibility: hidden">
        <svg viewBox="0 0 24 24"></svg>
      </span>
    </div>

    <div class="pd-stages-list">
      <button v-for="b in batches" :key="b.id" class="pd-stage bag-row" @click="pickExisting(b)">
        <div class="pd-stage-main">
          <span class="pd-stage-name">{{ b.roastDate ? formatShortDate(b.roastDate) : t('diary.empty') }}</span>
          <span class="pd-stage-detail">{{ b.roastDate ? NSXCore.getBatchAge(b.roastDate) : '' }}<template v-if="b.archived"> · {{ t('diary.archive') }}</template></span>
        </div>
      </button>
      <div v-if="loading" class="pick-empty">{{ t('diary.loading') }}</div>
      <div v-else-if="failed" class="pick-empty">{{ t('beanManager.batchesFailed') }}</div>
      <div v-else-if="!batches.length" class="pick-empty">{{ t('beanManager.noBatches') }}</div>
    </div>

    <!-- Same style and position as BeanChooser's "+ New bean" — a .btn, bottom
         left, not the small header icon this used to be. -->
    <div class="prep-bottom">
      <button class="btn" @click="openAddNew">+ {{ t('beanManager.addBatch') }}</button>
    </div>

    <RoastDatePicker
      v-if="showRoastPicker"
      @confirm="onRoastConfirm"
      @cancel="showRoastPicker = false"
    />
  </div>
</template>
