<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  diaryState, fullHistoryShots,
  goBack, cycleSort, setView, ensureDiaryLoaded,
  toggleProfileExpanded, openRecipeForBeanProfile,
  ensureShotMetrics, hasMoreHistory, loadMoreHistory,
  recipeRows, toggleRecipeExpanded, toggleEditingRecipes,
  batchRows, batchProfileGroups, enterBatch, loadBatchMap,
} from '../composables/useDiary.js';
import { openHistoryAt } from '../composables/useLiveShot.js';
import { openTextField, openConfirm, openChooser } from '../composables/useModals.js';
import { useLongPress } from '../composables/useLongPress.js';
// A `vFoo` binding in <script setup> registers as the v-foo directive.
import { vScrollEdges } from '../composables/useScrollEdges.js';
import { confirmAndDeleteBean, confirmAndDeleteBatch, toggleArchiveBean, toggleArchiveBatch } from '../composables/useBeanActions.js';
import { recipeIdentityParts, recipeCoffeeName, recipeRoasterName, formatLongDate } from '../composables/useCore.js';
import { selectRecipe, deleteRecipe, findRecipeForBeanProfile, togglePinRecipe } from '../composables/useRecipe.js';
import BeanEditor from '../components/BeanEditor.vue';
import BagsPanel from '../components/BagsPanel.vue';
import RecipePicker from '../components/RecipePicker.vue';
import DiaryShotRow from '../components/DiaryShotRow.vue';
import StarRating from '../components/StarRating.vue';
import { fmtTemp } from '../composables/useUnits.js';

const { t } = useI18n();
const router = useRouter();

/**
 * The coffee and bag the profile rows of an opened bag belong to. From an OPEN
 * bag the recipe brews from that very bag; from a done one (or a bean with no
 * bag) it joins the coffee's open bag, the way it always has.
 */
const groupBean = () => diaryState.batch?.bean;
const groupBatch = () => {
  const bag = diaryState.batch?.batch;
  return bag && !bag.archived ? bag : null;
};

async function goToRecipe(group) {
  try {
    // group.profile/context are the shot's own workflow data (real frames +
    // real dose/grind/temp, not just a title) — used both to recreate the
    // profile if it's since been deleted AND to seed the recipe with what was
    // actually brewed instead of stale leftover dial values. See useDiary.js.
    await openRecipeForBeanProfile(groupBean(), group.title, group.profile, group.context, groupBatch());
    router.push({ name: 'espresso' });
  } catch (err) {
    window.NSXCore.emit('toast', t('diary.recipeCreateFailed') + ': ' + err.message);
  }
}

// "+" creates a RECIPE (choose/add bean -> choose profile), not a bare bean —
// a bean on its own can't be brewed, so the recipe flow is the useful thing to
// start from here. Adding a bean is still reachable: it's step 1 of that flow.
// The Recipes view is hidden for now: in practice it shows much the same thing
// as an opened bag, only grouped by recipe instead of by coffee. Everything behind it
// stays — the view, its rows, the delete mode, the recipeRows computed — so
// bringing it back is flipping this one flag, not rebuilding it. Kept as a
// const rather than deleted-and-in-git because the segmented control's geometry
// depends on the count, and this way both places read it from the same value.
const SHOW_RECIPES_VIEW = false;

const showRecipeCreator = ref(false);
// 'bag' = the "+ New bag" flow (coffee -> roast date -> recipe), 'recipe' =
// "+ New recipe" — the same wizard, see RecipePicker's `mode`.
const creatorMode = ref('recipe');
function openCreator(mode) { creatorMode.value = mode; showRecipeCreator.value = true; }
function closeRecipeCreator() { showRecipeCreator.value = false; }
async function onRecipeCreated() {
  await ensureDiaryLoaded(); // the new bean/bag should show up in the Diary immediately
  router.push({ name: 'espresso' }); // the new recipe is now loaded — go brew it
}
// "+ New bag" ends here: the new bag opens, showing its coffee's recipes —
// pick one, or "+ New recipe", which then starts from this bag.
async function onBagOpened({ bean, batch }) {
  if (!batch?.id) return;
  await loadBatchMap(); // so the list has the bag on the way back out
  if (diaryState.view !== 'batches') setView('batches');
  enterBatch({ key: batch.id, batch, bean, lastShot: 0 });
}

onMounted(ensureDiaryLoaded);

// Recipes view: load it and go brew — same destination as an opened bag's
// profile rows, but straight from the library entry rather than rebuilding
// a recipe out of a shot's workflow.
async function loadRecipeRow(recipe) {
  await selectRecipe(recipe);
  router.push({ name: 'espresso' });
}
// The row's second line: what the recipe actually brews. calcRatio is core's,
// the same one the recipe cards use, so "1:2.0" means the same thing here.
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

/**
 * The saved recipe behind a profile group, if there is one. These rows are
 * derived from SHOTS, not from the library — a bean brewed on a profile always
 * has a row, whether or not a recipe was ever saved for that pairing (Load
 * Recipe creates one on the spot). So the delete button only appears where
 * there is actually something to delete.
 */
function savedRecipeForGroup(group) {
  return findRecipeForBeanProfile(groupBean(), group.title);
}

/**
 * A profile row: tap loads the recipe, press-and-hold opens Load / Pin /
 * Delete. The chevron on the right keeps expanding the shot history — that is
 * why the row itself was free to become the load action.
 */
const groupPress = useLongPress({ tap: goToRecipe, hold: openGroupMenu });

/**
 * A bag row: tap opens it, hold offers the coffee's menu — edit, bags,
 * archive, delete — plus Done/Reopen for the bag itself (also the row's
 * button; the menu just keeps every action in one list).
 */
async function openBagMenu(row) {
  const { bean, batch } = row;
  const options = [
    ['edit', t('diary.editBean')],
    ['bags', t('beanManager.batches')],
  ];
  // The bag's own actions, then the coffee's — each named for what it acts
  // on: a bare "Delete" on a bag row read as "delete this bag" and deleted
  // the whole bean, every bag of it included.
  if (batch) {
    options.push(['done', batch.archived ? t('diary.batchReopen') : t('diary.batchDone')]);
    options.push(['deleteBag', t('diary.deleteBag')]);
  }
  options.push(
    ['archive', bean.archived ? t('diary.unarchive') : t('diary.archiveCoffee')],
    ['delete', t('diary.deleteCoffee')],
  );
  const choice = await openChooser({ title: bean.name || '—', options });
  if (choice === 'edit') openEditBean(bean);
  else if (choice === 'bags') openBags(bean);
  else if (choice === 'done') await toggleBatchDone(row);
  else if (choice === 'deleteBag') { if (await confirmAndDeleteBatch(batch)) await loadBatchMap(); }
  else if (choice === 'archive') await toggleArchiveBean(bean);
  else if (choice === 'delete') await confirmAndDeleteBean(bean);
}
const bagPress = useLongPress({ tap: enterBatch, hold: openBagMenu });

/**
 * Which way the Batches levels slide (the list, and one bag opened). Derived
 * from the state rather than set by each caller, so a new caller cannot leave
 * it out of step.
 */
const drill = ref('drill-fwd');
watch(
  () => !!diaryState.batch,
  (open) => { drill.value = open ? 'drill-fwd' : 'drill-back'; }
);

async function openGroupMenu(group) {
  const saved = savedRecipeForGroup(group);
  const options = [['load', t('diary.loadRecipe')]];
  // Pin and Delete need something saved to act on. A pairing that was brewed
  // but never saved has only Load, which is what creates the recipe.
  if (saved) {
    options.push(['pin', saved.pinned ? t('diary.unpin') : t('diary.pin')]);
    options.push(['delete', t('common.delete')]);
  }
  const choice = await openChooser({ title: group.title, options });
  if (choice === 'load') await goToRecipe(group);
  else if (choice === 'pin') await togglePinRecipe(saved);
  else if (choice === 'delete') await removeRecipe(saved);
}

async function removeRecipe(recipe) {
  const ok = await openConfirm({
    title: t('diary.deleteRecipeConfirm'),
    message: `${recipeRoasterName(recipe)} – ${recipeCoffeeName(recipe)}`,
    danger: true,
    confirmLabel: t('common.delete'),
  });
  if (ok) await deleteRecipe(recipe.id);
}

/** The divider above an older bag's shots inside an opened bag's profile. */
function bagLabel(batch) {
  return batch?.roastDate ? t('diary.roastedOn', { date: formatLongDate(batch.roastDate) }) : t('diary.noRoastDate');
}

/**
 * Batches view: a bag's second line — roaster, then when it was roasted and
 * how long ago, then when it was last brewed (only if that is in the recent
 * shots window; see batchRows).
 */
function batchFacts(row) {
  const { batch, bean } = row;
  const roast = !batch ? t('diary.noBag')
    : batch.roastDate
      ? `${t('diary.roastedOn', { date: formatLongDate(batch.roastDate) })} (${window.NSXCore.getBatchAge(batch.roastDate)})`
      : t('diary.noRoastDate');
  const parts = [bean.roaster, roast];
  if (row.lastShot) parts.push(t('diary.lastBrewed', { date: formatLongDate(new Date(row.lastShot).toISOString()) }));
  return parts.filter(Boolean).join(' · ');
}

async function toggleBatchDone(row) {
  try {
    await toggleArchiveBatch(row.batch);
    // Flip it locally first so the row slides to its new place right away;
    // the reload (one request per bean) then just confirms it.
    row.batch.archived = !row.batch.archived;
    await loadBatchMap();
  } catch (err) {
    window.NSXCore.emit('toast', err?.message || String(err));
  }
}


const showBack = computed(() => diaryState.view === 'batches' && !!diaryState.batch);

const sortLabel = computed(() => t(`diary.sort${diaryState.sort[0].toUpperCase()}${diaryState.sort.slice(1)}`));
const searchPlaceholder = computed(() => {
  if (diaryState.view === 'full') return t('diary.searchProfile');
  if (diaryState.view === 'batches') return diaryState.batch ? t('diary.searchProfile') : t('diary.searchRoaster');
  return t('diary.search');
});

// History's rating filter: at least N stars, or every shot. The label says
// what is set, so the button doubles as the filter's state.
const ratingLabel = computed(() =>
  (diaryState.minStars ? t('diary.minStars', { n: diaryState.minStars }) : t('diary.allRatings')));
async function openRatingFilter() {
  const options = [[0, t('diary.allRatings')], ...[1, 2, 3, 4, 5].map((n) => [n, t('diary.minStars', { n })])];
  const choice = await openChooser({ title: t('diary.ratingFilter'), options, current: diaryState.minStars });
  if (choice != null) diaryState.minStars = Number(choice);
}

// The shared text-field modal already carries the on-screen keyboard and the
// cancel/confirm pair — cancel (null) keeps whatever filter was active, an
// empty confirmed string clears it.
async function openSearch() {
  const value = await openTextField({
    title: t('diary.search'),
    value: diaryState.query,
    placeholder: searchPlaceholder.value,
  });
  if (value !== null) diaryState.query = value;
}
function clearQuery() { diaryState.query = ''; }

const loadingMore = ref(false);
async function onLoadMore() {
  if (loadingMore.value) return;
  loadingMore.value = true;
  try { await loadMoreHistory(20); } finally { loadingMore.value = false; }
}

// Only an opened bag says where you are — the top level of each view is
// already named by the segmented control at the bottom, so repeating it here
// was a second label for the same thing.
const crumb = computed(() => {
  const open = diaryState.view === 'batches' ? diaryState.batch : null;
  if (!open) return '';
  const date = !open.batch ? t('diary.noBag')
    : open.batch.roastDate ? formatLongDate(open.batch.roastDate) : t('diary.noRoastDate');
  return `${open.bean.name} › ${date}`;
});

// "Edit bean" from a bag row's menu edits that bean in place.
const editingBean = ref(null);
const showEditor = ref(false);
function openEditBean(bean) {
  editingBean.value = bean;
  showEditor.value = true;
}
function closeEditor() { showEditor.value = false; }

// Bags (BagsPanel.vue) — mounted fresh per bean via v-if, so it needs no
// close-and-clear step of its own the way the editor's does.
const bagsBean = ref(null);
const showBags = ref(false);
function openBags(bean) {
  bagsBean.value = bean;
  showBags.value = true;
}
function closeBags() { showBags.value = false; }

// Rendering one shot (facts, measured metrics, stars) lives in DiaryShotRow —
// all three lists here show the same row, so it has one implementation.
// Fetch metrics for whatever shots are actually on screen: the flat full
// history, the shots under the one expanded profile group of an opened bag, or
// those under the one expanded recipe.
watch(
  () => (diaryState.view === 'full' ? fullHistoryShots.value : null),
  (list) => { if (list) ensureShotMetrics(list); },
  { immediate: true }
);
watch(
  () => diaryState.expandedProfile,
  (title) => {
    if (!title) return;
    const { current, earlier } = batchProfileGroups.value;
    const group = [...current, ...earlier].find((g) => g.title === title);
    if (group) ensureShotMetrics(group.ordered);
  }
);
watch(
  () => diaryState.expandedRecipe,
  (id) => {
    if (!id) return;
    const row = recipeRows.value.find((r) => r.recipe.id === id);
    if (row) ensureShotMetrics(row.shots);
  }
);
</script>

<template>
  <section class="page">
    <div class="page-title">{{ t('tab.diary') }}</div>
    <div class="diary-head">
      <!-- Always mounted (never v-if) and hidden via .invisible (visibility,
           not display) — the crumb sits directly after this in normal flow
           (see .diary-crumb), so the back button must always reserve its
           layout space, or the crumb's position would shift left whenever
           the button disappears (on the bag list, or in Full history). v-show wouldn't do it either: it toggles display:none,
           which removes the box from flow exactly like v-if would. -->
      <button
        class="ov-back"
        :class="{ invisible: !showBack }"
        :tabindex="showBack ? 0 : -1"
        @click="goBack"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('diary.back') }}
      </button>
      <span class="diary-crumb">{{ crumb }}</span>
      <!-- Grouped and pushed right as one block, independent of whether the Back
           button is present (a bare :first-of-type on .sort-btn broke as soon as
           the .ov-back <button> became the header's first button). -->
      <div class="diary-head-actions">
        <!-- Deleting a recipe is behind an explicit mode, like the profile
             library's: these rows are tapped constantly to expand/load, so a
             permanently visible trash icon would be one mis-tap from data loss. -->
        <button v-if="diaryState.view === 'recipes'" class="sort-btn" @click="toggleEditingRecipes">
          {{ diaryState.editingRecipes ? t('common.done') : t('common.edit') }}
        </button>
        <!-- The Batches view has one fixed order (open bags by last use, done
             bags at the end), so there is nothing for the sort to cycle. -->
        <button v-if="diaryState.view === 'full'" class="sort-btn" :class="{ accent: diaryState.minStars > 0 }" @click="openRatingFilter">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" /></svg>{{ ratingLabel }}
        </button>
        <button v-if="diaryState.view !== 'batches'" class="sort-btn" @click="cycleSort">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>{{ sortLabel }}
        </button>
      </div>
    </div>

    <!-- Full history: flat list across all beans. Cards, like every other
         Diary level (see "Browse as cards" in app.css) — this was the last
         hairline list left, and it was the one list whose rows are most worth
         reading as separate objects. -->
    <div v-if="diaryState.view === 'full'" v-scroll-edges class="list list-cards">
      <div class="lc-inner">
        <button
          v-for="shot in fullHistoryShots"
          :key="shot.id"
          class="list-row shot-row as-btn"
          @click="openHistoryAt(fullHistoryShots, shot)"
        >
          <DiaryShotRow :shot="shot" scope="history" />
        </button>
        <div v-if="!fullHistoryShots.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
        <button v-if="hasMoreHistory" class="load-more" :disabled="loadingMore" @click="onLoadMore">
          {{ loadingMore ? t('diary.loading') : t('diary.loadMore', { n: 20 }) }}
        </button>
      </div>
    </div>

    <!-- Recipes: the library itself, flat. Unlike a bag (which derives its
         rows from shots), these come from the saved recipes — so one that has
         never been brewed still appears, and the recipe's own rating shows. -->
    <div v-else-if="diaryState.view === 'recipes'" class="list">
      <template v-for="row in recipeRows" :key="row.recipe.id">
        <div class="list-row bean-row">
          <button class="row-main recipe-row-main" @click="toggleRecipeExpanded(row.recipe.id)">
            <span class="rmeta recipe-row-meta">
              <!-- Same dot-separated identity as the Coffee page's title bar
                   (shared via recipeIdentityParts), so a recipe reads the same
                   in the list as it does once loaded. -->
              <span class="recipe-row-id">
                <template v-for="(part, i) in recipeIdentityParts(row.recipe)" :key="i">
                  <span v-if="i > 0" class="dot">•</span>{{ part }}
                </template>
              </span>
              <span class="rsub">{{ recipeFacts(row.recipe) }}</span>
            </span>
          </button>
          <StarRating v-if="Number(row.recipe.rating) > 0" :model-value="Number(row.recipe.rating)" readonly :size="16" />
          <button class="row-edit" :aria-label="t('diary.expandProfile')" @click="toggleRecipeExpanded(row.recipe.id)">
            <span class="chev" :class="{ open: diaryState.expandedRecipe === row.recipe.id }">›</span>
          </button>
          <button
            v-if="diaryState.editingRecipes"
            class="row-edit danger"
            :aria-label="t('common.delete')"
            @click="removeRecipe(row.recipe)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
          </button>
          <button v-else class="load-recipe-btn" @click="loadRecipeRow(row.recipe)">{{ t('diary.loadRecipe') }}</button>
        </div>
        <div v-if="diaryState.expandedRecipe === row.recipe.id" class="sublist">
          <button
            v-for="shot in row.shots"
            :key="shot.id"
            class="list-row shot-row as-btn"
            @click="openHistoryAt(row.shots, shot)"
          >
            <DiaryShotRow :shot="shot" scope="recipe" />
          </button>
          <div v-if="!row.shots.length" class="list-row"><span class="rsub">{{ t('diary.noShotsYet') }}</span></div>
        </div>
      </template>
      <div v-if="!recipeRows.length" class="list-row"><span class="rsub">{{ t('diary.noRecipesYet') }}</span></div>
    </div>

    <!-- Batches: a sliding stage, so going deeper reads as going deeper.
         Each pane fills the stage absolutely, which is what lets the outgoing
         and incoming lists overlap during the slide. Pane one is one row per
         bag (plus one per bean that has none) — tap opens it, hold offers the
         coffee's menu, Done archives the bag, which sends it greyed to the end
         of the list (Reopen undoes that). Pane two is every recipe of that
         COFFEE as profile rows, the ones brewed with this bag first, then the
         ones only older bags had, under a divider; an expanded row lists its
         shots bag by bag (see batchProfileGroups). Labels sit here, not inside
         <Transition>, which rejects a comment as an extra child. -->
    <div v-if="diaryState.view === 'batches'" class="drill-stage">
      <Transition :name="drill">
        <div v-if="!diaryState.batch" key="batches" v-scroll-edges class="list list-cards">
          <!-- TransitionGroup, not a plain div: Done/Reopen re-sorts the list,
               and the row should slide to its new place, not jump there. -->
          <TransitionGroup tag="div" name="diary-batch-row" class="lc-inner">
            <div
              v-for="row in batchRows"
              :key="row.key"
              class="list-row bean-row diary-batch-row"
              :class="{ archived: row.batch?.archived }"
            >
              <button
                class="row-main"
                @pointerdown="bagPress.down($event, row)"
                @pointermove="bagPress.move"
                @pointerup="bagPress.up(row)"
                @pointercancel="bagPress.cancel"
                @pointerleave="bagPress.cancel"
              >
                <span class="rmeta">{{ row.bean.name }}<span class="rsub">{{ batchFacts(row) }}</span></span>
                <span class="chev">›</span>
              </button>
              <button v-if="row.batch" class="load-recipe-btn" @click="toggleBatchDone(row)">
                {{ row.batch.archived ? t('diary.batchReopen') : t('diary.batchDone') }}
              </button>
            </div>
            <div v-if="!batchRows.length" key="empty" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
          </TransitionGroup>
        </div>

        <div v-else key="batch-recipes" v-scroll-edges class="list list-cards">
          <div class="lc-inner">
            <template v-for="(list, half) in [batchProfileGroups.current, batchProfileGroups.earlier]" :key="half">
              <div v-if="half === 1 && list.length" class="diary-divider">{{ t('diary.earlierBags') }}</div>
              <template v-for="group in list" :key="group.title">
                <div class="list-row bean-row">
                  <button
                    class="row-main"
                    @pointerdown="groupPress.down($event, group)"
                    @pointermove="groupPress.move"
                    @pointerup="groupPress.up(group)"
                    @pointercancel="groupPress.cancel"
                    @pointerleave="groupPress.cancel"
                  >
                    <span class="rmeta">
                      <span class="row-title">
                        <svg v-if="savedRecipeForGroup(group)?.pinned" class="rp-pin" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" /><path d="M12 14v7" />
                        </svg>
                        {{ group.title }}
                      </span>
                    </span>
                    <StarRating
                      v-if="Number(savedRecipeForGroup(group)?.rating) > 0"
                      class="row-stars"
                      :model-value="Number(savedRecipeForGroup(group).rating)"
                      readonly
                      :size="15"
                    />
                  </button>
                  <button class="row-edit" :aria-label="t('diary.expandProfile')" @click="toggleProfileExpanded(group.title)">
                    <span class="chev" :class="{ open: diaryState.expandedProfile === group.title }">›</span>
                  </button>
                </div>
                <div v-if="diaryState.expandedProfile === group.title" class="sublist">
                  <template v-for="section in group.sections" :key="section.id ?? 'none'">
                    <div v-if="!section.current" class="sublist-divider">{{ bagLabel(section.batch) }}</div>
                    <button
                      v-for="shot in section.shots"
                      :key="shot.id"
                      class="list-row shot-row as-btn"
                      @click="openHistoryAt(group.ordered, shot)"
                    >
                      <DiaryShotRow :shot="shot" scope="profile" />
                    </button>
                  </template>
                </div>
              </template>
            </template>
            <div
              v-if="!batchProfileGroups.current.length && !batchProfileGroups.earlier.length"
              class="list-row"
            ><span class="rsub">{{ diaryState.query ? t('diary.noResults') : t('diary.noShotsYet') }}</span></div>
          </div>
        </div>
      </Transition>
    </div>

    <div class="diary-bottom">
      <!-- Batches (what is open, and through it every coffee's recipes) and
           History. The thumb's width and travel are derived from the count,
           so SHOW_RECIPES_VIEW switches to the three-segment variant. -->
      <div
        class="seg"
        :class="{ 'seg-3': SHOW_RECIPES_VIEW }"
        :data-pos="diaryState.view === 'full' ? 1 : diaryState.view === 'recipes' ? 2 : 0"
      >
        <span class="seg-thumb"></span>
        <button :class="{ on: diaryState.view === 'batches' }" @click="setView('batches')">{{ t('diary.batches') }}</button>
        <button :class="{ on: diaryState.view === 'full' }" @click="setView('full')">{{ t('diary.fullHistory') }}</button>
        <button v-if="SHOW_RECIPES_VIEW" :class="{ on: diaryState.view === 'recipes' }" @click="setView('recipes')">{{ t('diary.recipes') }}</button>
      </div>
      <span class="spacer" style="flex: 1"></span>
      <button v-if="diaryState.query" class="filter-chip" @click="clearQuery">
        {{ t('diary.filteredBy', { q: diaryState.query }) }}
        <span class="x" :aria-label="t('diary.clearFilter')">×</span>
      </button>
      <span class="spacer" style="flex: 1"></span>
      <!-- Not in History: that list is for finding shots already pulled, and
           neither flow starts from one. A new bag is the usual way in (it
           opens the bag, ready to pick a recipe); a new recipe is for trying
           another profile on a coffee. No separate "+ New bean": both flows
           add one inline in their coffee step. -->
      <template v-if="diaryState.view !== 'full'">
        <button class="btn" @click="openCreator('bag')">+ {{ t('diary.newBag') }}</button>
        <button class="btn" @click="openCreator('recipe')">+ {{ t('diary.addRecipe') }}</button>
      </template>
      <button class="rbtn" :aria-label="t('diary.search')" @click="openSearch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
      </button>
    </div>

    <PageTransition>
      <BeanEditor
        v-if="showEditor"
        :bean="editingBean"
        @close="closeEditor"
        @saved="closeEditor"
        @deleted="closeEditor"
      />
    </PageTransition>
    <PageTransition>
      <BagsPanel v-if="showBags" :bean="bagsBean" @close="closeBags" />
    </PageTransition>

    <!-- Seeded from the opened bag: its coffee's bean step is already answered. -->
    <PageTransition>
      <RecipePicker
        v-if="showRecipeCreator"
        :mode="creatorMode"
        :preset-bean="diaryState.view === 'batches' && diaryState.batch ? diaryState.batch.bean : null"
        :preset-batch="diaryState.view === 'batches' && diaryState.batch?.batch && !diaryState.batch.batch.archived ? diaryState.batch.batch : null"
        @back="closeRecipeCreator"
        @created="onRecipeCreated"
        @bag-opened="onBagOpened"
      />
    </PageTransition>
  </section>
</template>
