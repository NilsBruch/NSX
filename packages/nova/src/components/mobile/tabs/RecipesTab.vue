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
 * openGroupMenu. The pencil button opens RecipeDetail.vue, which can edit
 * dose/grind/yield/temp/grinder/rating (and roast date/bean once this entry
 * IS the loaded one) without loading it first.
 *
 * MobileShell.vue keeps diaryState.view in sync with the active phone tab
 * (this tab wants 'recipes', so recipeRows/cycleSort resolve against the
 * RIGHT vocabulary) — see the comment there for why that lives at the shell
 * level rather than here.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  diaryState, recipeRows, ensureDiaryLoaded, cycleSort,
} from '../../../composables/useDiary.js';
import { selectRecipe, togglePinRecipe, deleteRecipe } from '../../../composables/useRecipe.js';
import { recipeIdentityParts } from '../../../composables/useCore.js';
import { openTextField, openChooser, openConfirm } from '../../../composables/useModals.js';
import { useLongPress } from '../../../composables/useLongPress.js';
import { showToast } from '../../../composables/useToast.js';
import RecipeDetail from '../RecipeDetail.vue';
import RecipePicker from '../../RecipePicker.vue';
import StarRating from '../../StarRating.vue';
import { fmtTemp } from '../../../composables/useUnits.js';

const { t } = useI18n();

// Fires once per kept-alive instance (see MobileShell.vue) — repeat
// activations reuse the same module-level `recipes`/`shots` state (see
// useDiary.js/useCore.js), same pattern as DiaryTab.
onMounted(ensureDiaryLoaded);

const detailEntry = ref(null);
function openDetail(row) { detailEntry.value = row.recipe; }

// Same entry point the tablet's Diary "+" opens (RecipePicker) — no preset
// bean/roaster here, since this tab isn't browsing inside either.
const showRecipeCreator = ref(false);

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
    fmtTemp(r.groupTemp || 0),
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
      <button class="phone-icon-btn accent" :aria-label="t('diary.addRecipe')" @click="showRecipeCreator = true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
    </div>

    <button v-if="diaryState.query" class="phone-filter-chip" @click="diaryState.query = ''">
      {{ t('diary.filteredBy', { q: diaryState.query }) }} <span class="x">×</span>
    </button>

    <div class="phone-list">
      <div v-for="row in recipeRows" :key="row.recipe.id" class="phone-list-row phone-list-row-split">
        <button
          class="phone-row-main"
          @pointerdown="press.down($event, row)"
          @pointermove="press.move"
          @pointerup="press.up(row)"
          @pointercancel="press.cancel"
          @pointerleave="press.cancel"
        >
          <span class="rmeta">
            <span class="phone-identity-stack">
              <!-- Roaster and bean are one identity (the coffee) and share
                   this line's weight; only grinder/profile beyond them step
                   down to .rsub. -->
              <span v-for="(part, i) in recipeIdentityParts(row.recipe)" :key="i" :class="{ rsub: i > 1 }">{{ part }}</span>
            </span>
            <span class="rsub">{{ recipeFacts(row.recipe) }}</span>
          </span>
          <StarRating v-if="Number(row.recipe.rating) > 0" :model-value="Number(row.recipe.rating)" readonly :size="10" />
        </button>
        <button class="phone-row-edit" :aria-label="t('common.edit')" @click="openDetail(row)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
        </button>
      </div>
      <div v-if="!recipeRows.length" class="phone-empty">{{ t('diary.noRecipesYet') }}</div>
    </div>

    <PageTransition>
      <RecipeDetail v-if="detailEntry" :entry="detailEntry" @close="detailEntry = null" />
    </PageTransition>
    <PageTransition>
      <RecipePicker v-if="showRecipeCreator" @back="showRecipeCreator = false" @created="showRecipeCreator = false" />
    </PageTransition>
  </section>
</template>
