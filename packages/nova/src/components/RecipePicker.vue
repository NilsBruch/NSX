<script setup>
/**
 * The recipe library + the "new recipe" flow (choose/add bean -> choose profile
 * -> compose -> persist). Two entry points, one renderer:
 *   startStep 'list' — the espresso screen's recipe title: browse and load.
 *   startStep 'bean' — the Diary's "+" button: go straight to creating one.
 * The Diary skipping the library list is the ONLY difference, so it reuses this
 * rather than owning a second copy of the same two-step flow.
 *
 * The library is a card grid, not a row list: a recipe is only comparable to
 * another if you can see what it actually brews (dose -> yield, temp, grind),
 * and a row that fits none of that forces you to load each one to find out.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { recipe, recipes, refreshRecipes, selectRecipe, composeNewRecipe, createRecipeFromCurrent, duplicateRecipeAsNew, deleteRecipe } from '../composables/useRecipe.js';
import { shots, loadShots, grinders, singleGrinder, formatGrinderLabel } from '../composables/useCore.js';
import { openTextField, openChooser } from '../composables/useModals.js';
import BeanChooser from './BeanChooser.vue';
import ProfilePicker from './ProfilePicker.vue';
import StarRating from './StarRating.vue';

const props = defineProps({
  startStep: { type: String, default: 'list' }, // 'list' | 'bean'
});
const emit = defineEmits(['back', 'created']);
const { t } = useI18n();

const step = ref(props.startStep); // 'list' | 'bean' | 'profile'
const chosenBean = ref(null);
const query = ref('');
const editing = ref(false); // delete is only reachable in edit mode — see remove()

// Shots are what date a recipe (NSXCore.sortRecipesByLastUsed matches them by
// workflow key), so the library needs them loaded even when opened before the
// Diary ever was.
onMounted(() => {
  refreshRecipes();
  if (!shots.value.length) loadShots(200).catch(() => { /* unsorted list is still usable */ });
});

const isCurrent = (entry) => entry.id != null && entry.id === recipe.id;

// "Model (Burrs)" — looked up by id since a recipe entry only stores the model
// string, not the burr set. Falls back to a model-name match for legacy
// recipes saved before grinderId existed.
function grinderDisplay(entry) {
  const model = entry.grinderModel;
  if (!model || model === '—') return model;
  const g = grinders.value.find((x) => x.id === entry.grinderId) ?? grinders.value.find((x) => x.model === model);
  return g ? formatGrinderLabel(g) : model;
}

// Sort mode: 'use' (default) = most recently brewed first (core order);
// 'rating' = highest star rating first, last-used as the tiebreak.
const sortMode = ref('use');
function cycleSort() { sortMode.value = sortMode.value === 'use' ? 'rating' : 'use'; }
const sortLabel = computed(() => t(sortMode.value === 'rating' ? 'recipePicker.sortRating' : 'recipePicker.sortUse'));

const sortedRecipes = computed(() => {
  // Last-used order is the base for both modes (it's also the rating tiebreak).
  const byUse = window.NSXCore.sortRecipesByLastUsed(recipes.value, shots.value);
  if (sortMode.value !== 'rating') return byUse;
  const pos = new Map(byUse.map((r, i) => [r, i]));
  return byUse.slice().sort((a, b) =>
    ((Number(b.rating) || 0) - (Number(a.rating) || 0)) || (pos.get(a) - pos.get(b))
  );
});

const visibleRecipes = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return sortedRecipes.value;
  return sortedRecipes.value.filter((entry) =>
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

// While true, tapping a card doesn't load it — it seeds a NEW recipe from it
// instead (see startNewRecipe's "From existing recipe" choice).
const pickingDuplicateSource = ref(false);

async function pick(entry) {
  if (editing.value) return; // in edit mode a tap must not also load the recipe
  if (pickingDuplicateSource.value) {
    pickingDuplicateSource.value = false;
    await duplicateRecipeAsNew(entry);
    const created = await createRecipeFromCurrent();
    emit('created', created);
    emit('back');
    return;
  }
  await selectRecipe(entry);
  emit('back');
}

async function remove(entry, event) {
  event.stopPropagation();
  await deleteRecipe(entry.id);
}

async function startNewRecipe() {
  // "From existing recipe" only makes sense if there's one to start from.
  const options = [['blank', t('recipePicker.newBlank')]];
  if (recipes.value.length) options.push(['existing', t('recipePicker.fromExisting')]);
  if (options.length === 1) { step.value = 'bean'; return; }
  const v = await openChooser({ title: t('recipePicker.newRecipeChoiceTitle'), options, current: 'blank' });
  if (v === 'blank') step.value = 'bean';
  else if (v === 'existing') pickingDuplicateSource.value = true;
}

/** Backing out of the bean step: to the library if we came from it, otherwise
 *  (the Diary's straight-to-create entry) close the whole thing. */
function backFromBean() {
  if (props.startStep === 'list') step.value = 'list';
  else emit('back');
}

function onBeanPicked(bean) {
  chosenBean.value = bean;
  step.value = 'profile';
}

async function onProfilePicked(profile) {
  // With more than one grinder connected, a new recipe can't silently default
  // to "whichever grinder loaded first" — the user has to pick which one this
  // bean is actually ground on. A single grinder needs no such prompt.
  let seedContext = null;
  if (!singleGrinder.value) {
    const grinderId = await openChooser({
      title: t('recipePicker.chooseGrinder'),
      options: grinders.value.map((g) => [g.id, formatGrinderLabel(g)]),
      current: recipe.grinderId,
    });
    if (grinderId == null) return; // cancelled — stay on the profile step, no recipe created
    const grinder = grinders.value.find((g) => g.id === grinderId);
    seedContext = { grinderId: grinder.id, grinderModel: grinder.model || '—' };
  }
  await composeNewRecipe({ bean: chosenBean.value, profile, seedContext });
  const created = await createRecipeFromCurrent();
  emit('created', created);
  emit('back');
}
</script>

<template>
  <BeanChooser v-if="step === 'bean'" @pick="onBeanPicked" @back="backFromBean" />
  <ProfilePicker
    v-else-if="step === 'profile'"
    mode="pick"
    :current-title="recipe.profileTitle"
    @select="onProfilePicked"
    @back="step = 'bean'"
  />
  <div v-else class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <span class="ov-title">{{ t('recipePicker.title') }}</span>
      <button class="sort-btn rp-editbtn" @click="editing = !editing">{{ editing ? t('common.done') : t('common.edit') }}</button>
      <button class="sort-btn accent" @click="startNewRecipe">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>{{ t('recipePicker.newRecipe') }}
      </button>
    </div>

    <div v-if="pickingDuplicateSource" class="picking-banner">
      <span>{{ t('recipePicker.pickingSourceHint') }}</span>
      <button class="btn" @click="pickingDuplicateSource = false">{{ t('common.cancel') }}</button>
    </div>

    <div class="rp-strip">
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
          <!-- Always reserves its height (rp-rating min-height) so unrated cards
               are the same size as rated ones. -->
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
        <button
          v-if="editing"
          class="rp-del"
          :aria-label="t('common.delete')"
          @click="remove(entry, $event)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
        </button>
      </div>

      <div v-if="recipes.length && !visibleRecipes.length" class="rp-empty">{{ t('diary.noResults') }}</div>
      <div v-if="!recipes.length" class="rp-empty">{{ t('recipePicker.noRecipesYet') }}</div>
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
</template>
