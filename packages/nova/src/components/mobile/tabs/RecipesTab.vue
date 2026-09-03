<script setup>
/**
 * Phone "Recipes" — the recipe library as a flat, tappable list. This is the
 * tablet Diary's hidden `recipes` sub-view (SHOW_RECIPES_VIEW in
 * DiaryView.vue), promoted to its own tab: a phone companion is reached for
 * "load this" far more than it is browsed roaster-by-roaster, so recipes get
 * top billing instead of being a step buried in Diary.
 *
 * Tap loads the recipe onto the machine immediately (selectRecipe) — the
 * phone's decision that a recipe row IS the load action, not a preview of
 * one. Press-and-hold offers Load / Pin / Delete, same as the tablet's
 * openGroupMenu. Editing a recipe's own values (dose/grind/yield/temp/bean/
 * profile) is a later phase's pencil-button screen; this tab is read-and-load
 * only.
 *
 * MobileShell.vue keeps diaryState.view in sync with the active phone tab
 * (this tab wants 'recipes', so recipeRows/cycleSort resolve against the
 * RIGHT vocabulary) — see the comment there for why that lives at the shell
 * level rather than here.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  diaryState, recipeRows, ensureDiaryLoaded, cycleSort,
} from '../../../composables/useDiary.js';
import { selectRecipe, togglePinRecipe, deleteRecipe } from '../../../composables/useRecipe.js';
import { recipeIdentityParts } from '../../../composables/useCore.js';
import { openTextField, openChooser, openConfirm } from '../../../composables/useModals.js';
import { useLongPress } from '../../../composables/useLongPress.js';
import { showToast } from '../../../composables/useToast.js';
import StarRating from '../../StarRating.vue';

const { t } = useI18n();

// Fires once per kept-alive instance (see MobileShell.vue) — repeat
// activations reuse the same module-level `recipes`/`shots` state (see
// useDiary.js/useCore.js), same pattern as DiaryTab.
onMounted(ensureDiaryLoaded);

const sortLabel = computed(() => t(`diary.sort${diaryState.sort[0].toUpperCase()}${diaryState.sort.slice(1)}`));

async function openSearch() {
  const value = await openTextField({ title: t('diary.search'), value: diaryState.query, placeholder: t('recipePicker.searchPlaceholder') });
  if (value !== null) diaryState.query = value;
}

async function loadRow(row) {
  await selectRecipe(row.recipe);
  showToast(t('phone.recipeLoaded', { name: recipeIdentityParts(row.recipe).join(' • ') }));
}

async function openRowMenu(row) {
  const choice = await openChooser({
    title: recipeIdentityParts(row.recipe).join(' • '),
    options: [
      ['load', t('diary.loadRecipe')],
      ['pin', row.recipe.pinned ? t('diary.unpin') : t('diary.pin')],
      ['delete', t('common.delete')],
    ],
  });
  if (choice === 'load') await loadRow(row);
  else if (choice === 'pin') await togglePinRecipe(row.recipe);
  else if (choice === 'delete') await removeRow(row);
}

async function removeRow(row) {
  const ok = await openConfirm({
    title: t('diary.deleteRecipeConfirm'),
    message: `${row.recipe.coffeeRoaster} – ${row.recipe.coffeeName}`,
    danger: true,
    confirmLabel: t('common.delete'),
  });
  if (ok) await deleteRecipe(row.recipe.id);
}

// Same facts line as the tablet's recipes view: dose -> yield (ratio), grind,
// temp — see DiaryView.vue's recipeFacts, kept in step here on purpose.
function recipeFacts(r) {
  const dose = Number(r.targetDoseWeight) || 0;
  const yield_ = Number(r.targetYield) || 0;
  const ratio = window.NSXCore.calcRatio(dose, yield_);
  return [
    `${dose.toFixed(1)} → ${yield_.toFixed(1)} g (${ratio})`,
    `${t('espresso.grindSize')} ${r.grinderSetting}`,
    `${Number(r.groupTemp) || 0} °C`,
  ].join(' · ');
}

const press = useLongPress({ tap: loadRow, hold: openRowMenu });
</script>

<template>
  <section class="phone-page">
    <div class="phone-head">
      <span class="phone-crumb">{{ t('phone.recipes') }}</span>
      <button class="sort-btn" @click="cycleSort">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>{{ sortLabel }}
      </button>
      <button class="phone-icon-btn" :aria-label="t('diary.search')" @click="openSearch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
      </button>
    </div>

    <button v-if="diaryState.query" class="phone-filter-chip" @click="diaryState.query = ''">
      {{ t('diary.filteredBy', { q: diaryState.query }) }} <span class="x">×</span>
    </button>

    <div class="phone-list">
      <button
        v-for="row in recipeRows"
        :key="row.recipe.id"
        class="phone-list-row"
        @pointerdown="press.down($event, row)"
        @pointermove="press.move"
        @pointerup="press.up(row)"
        @pointercancel="press.cancel"
        @pointerleave="press.cancel"
      >
        <span class="rmeta">
          <span class="recipe-row-id">
            <template v-for="(part, i) in recipeIdentityParts(row.recipe)" :key="i">
              <span v-if="i > 0" class="dot">•</span>{{ part }}
            </template>
          </span>
          <span class="rsub">{{ recipeFacts(row.recipe) }}</span>
        </span>
        <StarRating v-if="Number(row.recipe.rating) > 0" :model-value="Number(row.recipe.rating)" readonly :size="15" />
      </button>
      <div v-if="!recipeRows.length" class="phone-empty">{{ t('diary.noRecipesYet') }}</div>
    </div>
  </section>
</template>
