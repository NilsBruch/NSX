<script setup>
/**
 * The recipe browser, as a blurred overlay rather than RecipePicker.vue's
 * full-page takeover (RecipePicker still serves the Diary's create flow).
 * Every difference is deliberate, not a simplification:
 *   - the espresso page stays visible (blurred) behind it, so the browser
 *     reads as a layer over the recipe rather than a separate screen;
 *   - the identity title it was opened from stays in the SAME spot, but
 *     splits into three separately-tappable bubbles — that continuity is
 *     what makes "tap the title, then tap the part you want" legible;
 *   - no Back button — tapping the backdrop closes it;
 *   - no create/edit/delete — this is only for switching to another recipe.
 *     Managing the library (deleting, reviewing shots per recipe) is the
 *     Diary's Recipes view; creating one is the Diary's "+".
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { recipe, recipes, refreshRecipes, selectRecipe, beanForRecipe } from '../composables/useRecipe.js';
import { shots, loadShots, grinders, singleGrinder, formatGrinderLabel } from '../composables/useCore.js';
import { openTextField } from '../composables/useModals.js';
import StarRating from './StarRating.vue';

const emit = defineEmits(['close', 'pickBean', 'pickGrinder', 'pickProfile']);
const { t } = useI18n();

// Same reason as RecipePicker: shots are what date a recipe, so the list
// needs them even if the Diary was never opened this session.
onMounted(() => {
  refreshRecipes();
  if (!shots.value.length) loadShots(200).catch(() => { /* unsorted list is still usable */ });
});

const query = ref('');
const sortMode = ref('use');

const isCurrent = (entry) => entry.id != null && entry.id === recipe.id;

// A recipe composed while no grinder existed yet carries none (useRecipe's
// composeNewRecipe falls back to '—'). "One grinder is implicit" only holds
// once the recipe actually HAS it, so an unset grinder stays pickable however
// many are configured — otherwise such a recipe can never be given one.
const grinderUnset = computed(() =>
  recipe.grinderId == null && (!recipe.grinderModel || recipe.grinderModel === '—')
);

function grinderDisplay(entry) {
  const model = entry.grinderModel;
  if (!model || model === '—') return model;
  const g = grinders.value.find((x) => x.id === entry.grinderId) ?? grinders.value.find((x) => x.model === model);
  return g ? formatGrinderLabel(g) : model;
}

function cycleSort() { sortMode.value = sortMode.value === 'use' ? 'rating' : 'use'; }
const sortLabel = computed(() => t(sortMode.value === 'rating' ? 'recipePicker.sortRating' : 'recipePicker.sortUse'));

const sortedRecipes = computed(() => {
  const byUse = window.NSXCore.sortRecipesByLastUsed(recipes.value, shots.value);
  if (sortMode.value !== 'rating') return byUse;
  const pos = new Map(byUse.map((r, i) => [r, i]));
  return byUse.slice().sort((a, b) =>
    ((Number(b.rating) || 0) - (Number(a.rating) || 0)) || (pos.get(a) - pos.get(b))
  );
});

/**
 * Archiving a bean in the Diary is how a coffee leaves the rotation without
 * losing its history — so its recipes leave this list with it, otherwise the
 * quick-switch browser keeps offering coffees that are finished.
 *
 * The loaded recipe is the one exception: it is what the machine is holding
 * right now, and a browser that omits the thing you are actually brewing (badge
 * and all) reads as a bug. Archiving is reversible and deliberately soft —
 * unlike deletion, which takes the recipes outright.
 */
const listedRecipes = computed(() =>
  sortedRecipes.value.filter((entry) => isCurrent(entry) || !beanForRecipe(entry)?.archived)
);

const visibleRecipes = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return listedRecipes.value;
  return listedRecipes.value.filter((entry) =>
    [entry.coffeeRoaster, entry.coffeeName, entry.profileTitle, entry.grinderModel]
      .some((v) => String(v || '').toLowerCase().includes(q))
  );
});

async function openSearch() {
  const value = await openTextField({ title: t('recipePicker.search'), value: query.value, placeholder: t('recipePicker.searchPlaceholder') });
  if (value !== null) query.value = value;
}

const num = (v, digits = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—');
const ratio = (entry) => window.NSXCore.calcRatio(Number(entry.targetDoseWeight) || 0, Number(entry.targetYield) || 0);

async function pick(entry) {
  await selectRecipe(entry);
  emit('close');
}
</script>

<template>
  <!-- .self so only a tap that lands on the scrim itself closes. The panel is
       pointer-events:none (see app.css), so taps on its empty areas DO land
       here and dismiss; its three interactive sections opt back in. -->
  <div class="rov-scrim" @click.self="emit('close')">
    <div class="rov-panel">
      <!-- Sits at the same offset as EspressoView's own .page-title +
           .recipe-identity, so the title the user tapped appears to stay put
           and split rather than being replaced by a new screen. -->
      <div class="page-title">{{ t('espresso.pageTitle') }}</div>

      <div class="rov-identity">
        <button class="rov-bubble" @click="emit('pickBean')">
          <span class="rov-bubble-label">{{ t('espresso.bean') }}</span>
          <span class="rov-bubble-name">{{ recipe.coffeeRoaster }} {{ recipe.coffeeName }}</span>
        </button>
        <!-- Nothing to switch TO with a single grinder (see useCore's
             singleGrinder) — plain, not a button, matching layout A. Unless the
             recipe has no grinder at all: then there IS something to set. -->
        <button v-if="!singleGrinder || grinderUnset" class="rov-bubble" @click="emit('pickGrinder')">
          <span class="rov-bubble-label">{{ t('espresso.grinder') }}</span>
          <span class="rov-bubble-name">{{ grinderUnset ? '—' : recipe.grinderModel }}</span>
        </button>
        <div v-else class="rov-bubble plain">
          <span class="rov-bubble-label">{{ t('espresso.grinder') }}</span>
          <span class="rov-bubble-name">{{ recipe.grinderModel }}</span>
        </div>
        <button class="rov-bubble" @click="emit('pickProfile')">
          <span class="rov-bubble-label">{{ t('espresso.profile') }}</span>
          <span class="rov-bubble-name">{{ recipe.profileTitle }}</span>
        </button>
      </div>

      <div class="rp-strip rov-strip">
        <div
          v-for="entry in visibleRecipes"
          :key="entry.id"
          class="rp-card"
          :class="{ current: isCurrent(entry) }"
          @click="pick(entry)"
        >
          <span v-if="isCurrent(entry)" class="rp-badge">{{ t('common.current') }}</span>
          <div class="rp-head">
            <span class="rp-roaster">{{ entry.coffeeRoaster }}</span>
            <span class="rp-name">{{ entry.coffeeName }}</span>
            <div class="rp-rating">
              <StarRating v-if="Number(entry.rating) > 0" :model-value="Number(entry.rating)" readonly :size="16" />
            </div>
          </div>
          <div class="rp-rows">
            <div v-if="!singleGrinder" class="rp-row-duo">
              <div class="rp-row">
                <span class="rp-label">{{ t('recipePicker.lGrinder') }}</span>
                <span class="rp-val">{{ grinderDisplay(entry) }}</span>
              </div>
              <div class="rp-row">
                <span class="rp-label">{{ t('recipePicker.lGrind') }}</span>
                <span class="rp-val">{{ entry.grinderSetting }}</span>
              </div>
            </div>
            <div v-else class="rp-row">
              <span class="rp-label">{{ t('recipePicker.lGrind') }}</span>
              <span class="rp-val">{{ entry.grinderSetting }}</span>
            </div>
            <div class="rp-row-duo">
              <div class="rp-row">
                <span class="rp-label">{{ t('recipePicker.lBeverage') }}</span>
                <span class="rp-val">{{ num(entry.targetDoseWeight) }} → {{ num(entry.targetYield) }} g <span class="rp-ratio">({{ ratio(entry) }})</span></span>
              </div>
              <div class="rp-row">
                <span class="rp-label">{{ t('recipePicker.lTemp') }}</span>
                <span class="rp-val">{{ num(entry.groupTemp, 0) }} °C</span>
              </div>
            </div>
          </div>
          <div class="rp-row rp-profile">
            <span class="rp-label">{{ t('recipePicker.lProfile') }}</span>
            <span class="rp-chip">{{ entry.profileTitle }}</span>
          </div>
        </div>

        <!-- Both read from listedRecipes, not the raw library: with every
             recipe's bean archived, "no results" would blame a search nobody
             ran. Nothing to offer is "no recipes yet"; a query that matched
             none of what IS on offer is "no results". -->
        <div v-if="listedRecipes.length && !visibleRecipes.length" class="rp-empty">{{ t('diary.noResults') }}</div>
        <div v-if="!listedRecipes.length" class="rp-empty">{{ t('recipePicker.noRecipesYet') }}</div>
      </div>

      <div class="rp-bottom">
        <button class="sort-btn" @click="cycleSort">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>{{ sortLabel }}
        </button>
        <span class="spacer" style="flex: 1"></span>
        <button v-if="query" class="filter-chip" @click="query = ''">
          {{ t('diary.filteredBy', { q: query }) }}<span class="x">×</span>
        </button>
        <span class="spacer" style="flex: 1"></span>
        <button class="rbtn" :aria-label="t('recipePicker.search')" @click="openSearch">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>
