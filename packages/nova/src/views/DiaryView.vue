<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  diaryState, roasterGroups, beansInRoaster, fullHistoryShots,
  enterRoaster, enterBean, goBack, cycleSort, setView, toggleArchived, ensureDiaryLoaded,
  profileGroupsInBean, toggleProfileExpanded, openRecipeForBeanProfile,
  ensureShotMetrics, hasMoreShots, loadMoreFullHistory,
  recipeRows, toggleRecipeExpanded, toggleEditingRecipes,
} from '../composables/useDiary.js';
import { openHistoryAt } from '../composables/useLiveShot.js';
import { openTextField, openConfirm, openChooser } from '../composables/useModals.js';
import { useLongPress } from '../composables/useLongPress.js';
// A `vFoo` binding in <script setup> registers as the v-foo directive.
import { vScrollEdges } from '../composables/useScrollEdges.js';
import { confirmAndDeleteBean, toggleArchiveBean } from '../composables/useBeanActions.js';
import { recipeIdentityParts } from '../composables/useCore.js';
import { selectRecipe, deleteRecipe, findRecipeForBeanProfile, togglePinRecipe } from '../composables/useRecipe.js';
import BeanEditor from '../components/BeanEditor.vue';
import RecipePicker from '../components/RecipePicker.vue';
import DiaryShotRow from '../components/DiaryShotRow.vue';
import StarRating from '../components/StarRating.vue';

const { t } = useI18n();
const router = useRouter();

async function goToRecipe(group) {
  try {
    // group.profile/context are the shot's own workflow data (real frames +
    // real dose/grind/temp, not just a title) — used both to recreate the
    // profile if it's since been deleted AND to seed the recipe with what was
    // actually brewed instead of stale leftover dial values. See useDiary.js.
    await openRecipeForBeanProfile(diaryState.bean, group.title, group.profile, group.context);
    router.push({ name: 'espresso' });
  } catch (err) {
    window.NSXCore.emit('toast', t('diary.recipeCreateFailed') + ': ' + err.message);
  }
}

// "+" creates a RECIPE (choose/add bean -> choose profile), not a bare bean —
// a bean on its own can't be brewed, so the recipe flow is the useful thing to
// start from here. Adding a bean is still reachable: it's step 1 of that flow.
// The Recipes view is hidden for now: in practice it shows much the same thing
// as Browse, only grouped by recipe instead of by roaster. Everything behind it
// stays — the view, its rows, the delete mode, the recipeRows computed — so
// bringing it back is flipping this one flag, not rebuilding it. Kept as a
// const rather than deleted-and-in-git because the segmented control's geometry
// depends on the count, and this way both places read it from the same value.
const SHOW_RECIPES_VIEW = false;

const showRecipeCreator = ref(false);
function closeRecipeCreator() { showRecipeCreator.value = false; }
async function onRecipeCreated() {
  await ensureDiaryLoaded(); // the new bean/bag should show up in the Diary immediately
  router.push({ name: 'espresso' }); // the new recipe is now loaded — go brew it
}

onMounted(ensureDiaryLoaded);

// Recipes view: load it and go brew — same destination as the Browse view's
// own load button, but straight from the library entry rather than rebuilding
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
    `${Number(r.groupTemp) || 0} °C`,
  ].join(' · ');
}

/**
 * Origin, variety and process as one dot-separated line under a bean's name.
 * All three are optional and a bean with none of them is common, so empties are
 * dropped rather than printed as "—" — the same rule recipeIdentityParts
 * follows for the Coffee page's title. A bean with nothing to add keeps just
 * its name instead of gaining an empty second line.
 *
 * `variety` is an array in the bean record while the other two are plain
 * strings, so it is joined before the shared filter sees it.
 */
function beanFacts(bean) {
  const variety = Array.isArray(bean?.variety) ? bean.variety.join(', ') : bean?.variety;
  return [bean?.country, variety, bean?.processing]
    .map((v) => String(v ?? '').trim())
    .filter((v) => v && v !== '—')
    .join(' · ');
}

/**
 * The saved recipe behind a profile group, if there is one. These rows are
 * derived from SHOTS, not from the library — a bean brewed on a profile always
 * has a row, whether or not a recipe was ever saved for that pairing (Load
 * Recipe creates one on the spot). So the delete button only appears where
 * there is actually something to delete.
 */
function savedRecipeForGroup(group) {
  return findRecipeForBeanProfile(diaryState.bean, group.title);
}

/**
 * A profile row: tap loads the recipe, press-and-hold opens Load / Pin /
 * Delete. The chevron on the right keeps expanding the shot history — that is
 * why the row itself was free to become the load action.
 */
const groupPress = useLongPress({ tap: goToRecipe, hold: openGroupMenu });

/**
 * Bean rows behave like the profile rows below them: tap opens the bean, hold
 * offers what used to be a pencil button. Dropping that button is the point —
 * a row with a permanent affordance on the right invites aiming at it, while
 * the row itself (the far bigger target) did the more common thing.
 */
async function openBeanMenu(bean) {
  const choice = await openChooser({
    title: bean.name || '—',
    options: [
      ['edit', t('diary.editBean')],
      ['archive', bean.archived ? t('diary.unarchive') : t('diary.archive')],
      ['delete', t('common.delete')],
    ],
  });
  if (choice === 'edit') openEditBean(bean);
  else if (choice === 'archive') await toggleArchiveBean(bean);
  else if (choice === 'delete') await confirmAndDeleteBean(bean);
}
const beanPress = useLongPress({ tap: enterBean, hold: openBeanMenu });

/**
 * Which way the browse levels slide. Derived from the level itself rather than
 * set by each caller: enterRoaster/enterBean/goBack all just change the level,
 * and a direction that is computed from it cannot fall out of step with a new
 * caller someone adds later.
 */
const drill = ref('drill-fwd');
watch(
  () => diaryState.level,
  (level, prev) => { drill.value = level >= prev ? 'drill-fwd' : 'drill-back'; }
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
    message: `${recipe.coffeeRoaster} – ${recipe.coffeeName}`,
    danger: true,
    confirmLabel: t('common.delete'),
  });
  if (ok) await deleteRecipe(recipe.id);
}

const sortLabel = computed(() => t(`diary.sort${diaryState.sort[0].toUpperCase()}${diaryState.sort.slice(1)}`));
const searchPlaceholder = computed(() => {
  if (diaryState.view === 'full') return t('diary.searchProfile');
  return [t('diary.searchRoaster'), t('diary.searchBean'), t('diary.searchProfile')][diaryState.level];
});

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
  try { await loadMoreFullHistory(20); } finally { loadingMore.value = false; }
}

const crumb = computed(() => {
  if (diaryState.view === 'full') return t('diary.fullHistory');
  if (diaryState.view === 'recipes') return t('diary.recipes');
  if (diaryState.level === 0) return t('diary.roasters');
  if (diaryState.level === 1) return diaryState.roasterName;
  return `${diaryState.roasterName} › ${diaryState.bean?.name ?? ''}`;
});

// The pencil on a bean row still edits that bean in place — only the "+" changed.
const editingBean = ref(null);
const showEditor = ref(false);
function openEditBean(bean) {
  editingBean.value = bean;
  showEditor.value = true;
}
function closeEditor() { showEditor.value = false; }

// Rendering one shot (facts, measured metrics, stars) lives in DiaryShotRow —
// all three lists here show the same row, so it has one implementation.
// Fetch metrics for whatever shots are actually on screen: the flat full
// history, the shots under the one expanded profile group, or those under the
// one expanded recipe.
watch(
  () => (diaryState.view === 'full' ? fullHistoryShots.value : null),
  (list) => { if (list) ensureShotMetrics(list); },
  { immediate: true }
);
watch(
  () => diaryState.expandedProfile,
  (title) => {
    if (!title) return;
    const group = profileGroupsInBean.value.find((g) => g.title === title);
    if (group) ensureShotMetrics(group.shots);
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
           the button disappears (browsing at the top level, or in Full
           history). v-show wouldn't do it either: it toggles display:none,
           which removes the box from flow exactly like v-if would. -->
      <button
        class="ov-back"
        :class="{ invisible: !(diaryState.view === 'browse' && diaryState.level > 0) }"
        :tabindex="diaryState.view === 'browse' && diaryState.level > 0 ? 0 : -1"
        @click="goBack"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('diary.back') }}
      </button>
      <span class="diary-crumb">{{ crumb }}</span>
      <!-- Grouped and pushed right as one block, independent of whether the Back
           button is present (a bare :first-of-type on .sort-btn broke as soon as
           the .ov-back <button> became the header's first button). -->
      <div class="diary-head-actions">
        <!-- Archived is a bean concept, so the toggle only applies while browsing
             roasters/beans (not the flat shot history or a bean's shot list). -->
        <button v-if="diaryState.view === 'browse' && diaryState.level < 2" class="sort-btn" :class="{ accent: diaryState.showArchived }" @click="toggleArchived">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M5 5v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5M9 9v8M15 9v8" /></svg>{{ diaryState.showArchived ? t('diary.hideArchived') : t('diary.showAll') }}
        </button>
        <!-- Deleting a recipe is behind an explicit mode, like the profile
             library's: these rows are tapped constantly to expand/load, so a
             permanently visible trash icon would be one mis-tap from data loss. -->
        <button v-if="diaryState.view === 'recipes'" class="sort-btn" @click="toggleEditingRecipes">
          {{ diaryState.editingRecipes ? t('common.done') : t('common.edit') }}
        </button>
        <button class="sort-btn" @click="cycleSort">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>{{ sortLabel }}
        </button>
      </div>
    </div>

    <!-- Full history: flat list across all beans -->
    <div v-if="diaryState.view === 'full'" class="list">
      <button
        v-for="shot in fullHistoryShots"
        :key="shot.id"
        class="list-row shot-row as-btn"
        @click="openHistoryAt(fullHistoryShots, shot)"
      >
        <DiaryShotRow :shot="shot" scope="history" />
      </button>
      <div v-if="!fullHistoryShots.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
      <button v-if="hasMoreShots" class="load-more" :disabled="loadingMore" @click="onLoadMore">
        {{ loadingMore ? t('diary.loading') : t('diary.loadMore', { n: 20 }) }}
      </button>
    </div>

    <!-- Recipes: the library itself, flat. Unlike Browse (which derives its
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

    <!-- One stage, three panes: the levels slide instead of cutting, so
         going deeper reads as going deeper. Each pane fills the stage
         absolutely, which is what lets the outgoing and incoming lists
         overlap during the slide instead of stacking vertically.
         The three panes are roasters (0) -> beans in a roaster (1) -> profiles
         used with a bean (2). Their labels live here rather than above each
         branch because <Transition> counts a comment as a child and rejects
         anything but exactly one. -->
    <div v-if="diaryState.view === 'browse'" class="drill-stage">
      <Transition :name="drill">
        <div v-if="diaryState.level === 0" key="roasters" v-scroll-edges class="list list-cards">
          <div class="lc-inner">
            <button v-for="g in roasterGroups" :key="g.name" class="list-row" @click="enterRoaster(g.name)">
              <span class="rmeta">{{ g.name }}<span class="rsub">{{ g.beans.length }} bean{{ g.beans.length !== 1 ? 's' : '' }}</span></span>
              <span class="chev">›</span>
            </button>
            <div v-if="!roasterGroups.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
          </div>
        </div>

        <div v-else-if="diaryState.level === 1" key="beans" v-scroll-edges class="list list-cards">
          <div class="lc-inner">
            <div v-for="bean in beansInRoaster" :key="bean.id" class="list-row bean-row">
              <button
                class="row-main"
                @pointerdown="beanPress.down($event, bean)"
                @pointermove="beanPress.move"
                @pointerup="beanPress.up(bean)"
                @pointercancel="beanPress.cancel"
                @pointerleave="beanPress.cancel"
              >
                <span class="rmeta rmeta-inline">
                  <span class="bean-name">{{ bean.name }}</span>
                  <span v-if="beanFacts(bean)" class="rsub">{{ beanFacts(bean) }}</span>
                </span>
                <span class="chev">›</span>
              </button>
            </div>
            <div v-if="!beansInRoaster.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
          </div>
        </div>

        <div v-else key="profiles" v-scroll-edges class="list list-cards">
          <div class="lc-inner">
            <template v-for="group in profileGroupsInBean" :key="group.title">
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
                  <!-- The recipe's own rating, which until now only the Recipes
                       view showed — and that view is hidden, so it had nowhere
                       left to appear. Only for a pairing that HAS a saved
                       recipe, and only once it is actually rated: an empty row
                       of outlines on every line would read as "rated zero". -->
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
                <button
                  v-for="shot in group.shots"
                  :key="shot.id"
                  class="list-row shot-row as-btn"
                  @click="openHistoryAt(group.shots, shot)"
                >
                  <DiaryShotRow :shot="shot" scope="profile" />
                </button>
              </div>
            </template>
            <div v-if="!profileGroupsInBean.length" class="list-row"><span class="rsub">{{ t('diary.noShotsYet') }}</span></div>
          </div>
        </div>

      </Transition>
    </div>

    <div class="diary-bottom">
      <!-- seg-3 only while there are three: the thumb's width and its
           travel per position are both derived from the count, so leaving the
           class on with a button hidden would size it for a segment that
           isn't there. -->
      <div
        class="seg"
        :class="{ 'seg-3': SHOW_RECIPES_VIEW }"
        :data-pos="diaryState.view === 'full' ? 1 : diaryState.view === 'recipes' ? 2 : 0"
      >
        <span class="seg-thumb"></span>
        <button :class="{ on: diaryState.view === 'browse' }" @click="setView('browse')">{{ t('diary.browse') }}</button>
        <button :class="{ on: diaryState.view === 'full' }" @click="setView('full')">{{ t('diary.fullHistory') }}</button>
        <button v-if="SHOW_RECIPES_VIEW" :class="{ on: diaryState.view === 'recipes' }" @click="setView('recipes')">{{ t('diary.recipes') }}</button>
      </div>
      <span class="spacer" style="flex: 1"></span>
      <button v-if="diaryState.query" class="filter-chip" @click="clearQuery">
        {{ t('diary.filteredBy', { q: diaryState.query }) }}
        <span class="x" :aria-label="t('diary.clearFilter')">×</span>
      </button>
      <span class="spacer" style="flex: 1"></span>
      <!-- Present in all three views, not just Browse: what it creates (a
           recipe) is equally the thing you'd want to add while looking at the
           shot history or the recipe list, and a button that comes and goes
           with the segment is one the hand can't learn. -->
      <button
        class="rbtn accent"
        :aria-label="t('diary.addRecipe')"
        @click="showRecipeCreator = true"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <button class="rbtn" :aria-label="t('diary.search')" @click="openSearch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
      </button>
    </div>

    <BeanEditor
      v-if="showEditor"
      :bean="editingBean"
      :preset-roaster="diaryState.level === 1 ? diaryState.roasterName : ''"
      @close="closeEditor"
      @saved="closeEditor"
      @deleted="closeEditor"
    />

    <RecipePicker
      v-if="showRecipeCreator"

      @back="closeRecipeCreator"
      @created="onRecipeCreated"
    />
  </section>
</template>
