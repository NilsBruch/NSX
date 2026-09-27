<script setup>
/**
 * Phone "Diary" — the same roaster -> bean -> profile -> shot drill-down as
 * DiaryView.vue (same composable, same state), plus its flat full-history
 * toggle, reflowed into a single scrolling column instead of the tablet's
 * fixed page chrome. Recipe library management now has its own phone tab
 * (RecipesTab.vue); this one keeps the tablet's browse/full split.
 *
 * MobileShell.vue keeps diaryState.view off 'recipes' while this tab is
 * active (see the comment there) — this file only ever toggles between
 * 'browse' and 'full'.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  diaryState, roasterGroups, beansInRoaster, fullHistoryShots,
  enterRoaster, enterBean, goBack, cycleSort, setView, toggleArchived, ensureDiaryLoaded,
  profileGroupsInBean, toggleProfileExpanded, openRecipeForBeanProfile,
  shotMetrics, ensureShotMetrics, hasMoreHistory, loadMoreHistory,
} from '../../../composables/useDiary.js';
import { findRecipeForBeanProfile, togglePinRecipe, deleteRecipe } from '../../../composables/useRecipe.js';
import { toggleArchiveBean, confirmAndDeleteBean } from '../../../composables/useBeanActions.js';
import { openTextField, openChooser, openConfirm } from '../../../composables/useModals.js';
import { openHistoryAt } from '../../../composables/useLiveShot.js';
import { singleGrinder, formatShortDate, recipeCoffeeName, recipeRoasterName } from '../../../composables/useCore.js';
import { useLongPress } from '../../../composables/useLongPress.js';
import { goPhoneTab } from '../../../composables/usePhoneNav.js';
import RecipePicker from '../../RecipePicker.vue';
import BeanEditor from '../../BeanEditor.vue';
import BagsPanel from '../../BagsPanel.vue';

const { t } = useI18n();

onMounted(ensureDiaryLoaded);

/**
 * The header keeps a SHORT, fixed title; where you are in the drill-down goes
 * on its own line below (see `path`). The header shares its row with up to
 * four icon buttons, which leaves a roaster name — let alone "roaster ›
 * bean" — a few characters before it ellipsises into nothing.
 */
const crumb = computed(() =>
  (diaryState.view === 'full' ? t('diary.fullHistory') : t('diary.roasters')));

const path = computed(() => {
  if (diaryState.view === 'full' || diaryState.level === 0) return '';
  if (diaryState.level === 1) return diaryState.roasterName;
  return `${diaryState.roasterName} › ${diaryState.bean?.name ?? ''}`;
});
const searchPlaceholder = computed(() => {
  if (diaryState.view === 'full') return t('diary.searchProfile');
  return [t('diary.searchRoaster'), t('diary.searchBean'), t('diary.searchProfile')][diaryState.level];
});
const sortLabel = computed(() => t(`diary.sort${diaryState.sort[0].toUpperCase()}${diaryState.sort.slice(1)}`));

async function openSearch() {
  const value = await openTextField({ title: t('diary.search'), value: diaryState.query, placeholder: searchPlaceholder.value });
  if (value !== null) diaryState.query = value;
}

const starLevel = (shot) => window.NSXCore.enjoymentToStars(shot?.annotations?.enjoyment);
const factsFor = (shot) => window.NSXCore.mapShotToWorkflow(shot);
const actualDose = (shot) => window.NSXCore.resolveActualDose(shot);
const metricsFor = (shot) => shotMetrics.get(shot.id) || null;


function onEnterBean(bean) {
  enterBean(bean);
}

// Bean row: tap opens it (unchanged), hold offers what used to need a pencil
// button — same menu and same three actions as the tablet's openBeanMenu.
const showBeanEditor = ref(false);
const editingBean = ref(null);
function openEditBean(bean) {
  editingBean.value = bean;
  showBeanEditor.value = true;
}
function closeBeanEditor() { showBeanEditor.value = false; }

// Bags (BagsPanel.vue) — mounted fresh per bean via v-if, so it needs no
// close-and-clear step of its own the way the editor's does.
const bagsBean = ref(null);
const showBags = ref(false);
function openBags(bean) {
  bagsBean.value = bean;
  showBags.value = true;
}
function closeBags() { showBags.value = false; }

async function openBeanMenu(bean) {
  const choice = await openChooser({
    title: bean.name || '—',
    options: [
      ['edit', t('diary.editBean')],
      ['bags', t('beanManager.batches')],
      ['archive', bean.archived ? t('diary.unarchive') : t('diary.archive')],
      ['delete', t('common.delete')],
    ],
  });
  if (choice === 'edit') openEditBean(bean);
  else if (choice === 'bags') openBags(bean);
  else if (choice === 'archive') await toggleArchiveBean(bean);
  else if (choice === 'delete') await confirmAndDeleteBean(bean);
}
const beanPress = useLongPress({ tap: onEnterBean, hold: openBeanMenu });

// Profile-group row: tap keeps expanding the shot history below it (unchanged
// — that's already this row's job here, unlike the tablet's browse row, which
// taps straight to loading the recipe since RecipesTab didn't exist there).
// Hold adds the same Load / Pin / Delete the tablet's openGroupMenu offers.
// Load routes to the phone's Recipes tab rather than router.push({name:
// 'espresso'}) — the phone has no router navigation of its own (usePhoneNav.js).
function savedRecipeForGroup(group) {
  return findRecipeForBeanProfile(diaryState.bean, group.title);
}
async function loadGroupRecipe(group) {
  try {
    await openRecipeForBeanProfile(diaryState.bean, group.title, group.profile, group.context);
    goPhoneTab('recipes');
  } catch (err) {
    window.NSXCore.emit('toast', t('diary.recipeCreateFailed') + ': ' + err.message);
  }
}
async function removeGroupRecipe(recipe) {
  const ok = await openConfirm({
    title: t('diary.deleteRecipeConfirm'),
    message: `${recipeRoasterName(recipe)} – ${recipeCoffeeName(recipe)}`,
    danger: true,
    confirmLabel: t('common.delete'),
  });
  if (ok) await deleteRecipe(recipe.id);
}
async function openGroupMenu(group) {
  const saved = savedRecipeForGroup(group);
  const options = [['load', t('diary.loadRecipe')]];
  // Pin and Delete need something saved to act on — a pairing that was
  // brewed but never saved as a recipe has only Load, which is what creates
  // one (same rule as the tablet).
  if (saved) {
    options.push(['pin', saved.pinned ? t('diary.unpin') : t('diary.pin')]);
    options.push(['delete', t('common.delete')]);
  }
  const choice = await openChooser({ title: group.title, options });
  if (choice === 'load') await loadGroupRecipe(group);
  else if (choice === 'pin') await togglePinRecipe(saved);
  else if (choice === 'delete') await removeGroupRecipe(saved);
}
const groupPress = useLongPress({ tap: (group) => toggleProfileExpanded(group.title), hold: openGroupMenu });

// Metrics for whatever's expanded once a bean is drilled into, or for the
// flat full-history list once that's the active view.
watch(
  () => diaryState.expandedProfile,
  (title) => {
    if (!title) return;
    const group = profileGroupsInBean.value.find((g) => g.title === title);
    if (group) ensureShotMetrics(group.shots);
  }
);
watch(
  () => (diaryState.view === 'full' ? fullHistoryShots.value : null),
  (list) => { if (list) ensureShotMetrics(list); },
  { immediate: true }
);

const loadingMore = ref(false);
async function onLoadMore() {
  if (loadingMore.value) return;
  loadingMore.value = true;
  try { await loadMoreHistory(20); } finally { loadingMore.value = false; }
}

const showRecipeCreator = ref(false);
function closeRecipeCreator() { showRecipeCreator.value = false; }
async function onRecipeCreated() {
  await ensureDiaryLoaded(); // the new bean/bag should show up immediately
  closeRecipeCreator();
}
</script>

<template>
  <section class="phone-page">
    <div class="phone-head">
      <button v-if="diaryState.view === 'browse' && diaryState.level > 0" class="phone-back" :aria-label="t('diary.back')" @click="goBack">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span class="phone-crumb">{{ crumb }}</span>
      <!-- Same archive-box glyph as DiaryView.vue's toggle (see its comment) —
           it matters more here: with no room in the header for the tablet's
           text label, an icon-only trash can would have read as "delete". -->
      <button v-if="diaryState.view === 'browse' && diaryState.level < 2" class="sort-btn icon-only" :class="{ accent: diaryState.showArchived }" :aria-label="diaryState.showArchived ? t('diary.hideArchived') : t('diary.showAll')" @click="toggleArchived">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v4H3z" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>
      </button>
      <button class="sort-btn icon-only" :aria-label="sortLabel" @click="cycleSort">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>
      </button>
      <button class="phone-icon-btn" :aria-label="t('diary.search')" @click="openSearch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
      </button>
      <button class="phone-icon-btn accent" :aria-label="t('diary.addRecipe')" @click="showRecipeCreator = true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
    </div>

    <!-- Where you are, with a full line to say it in. -->
    <span v-if="path" class="phone-path">{{ path }}</span>

    <!-- Browse/History toggle sits right under the header, not at the foot of
         a scrolling list (the tablet can pin it to the page bottom because
         .page has a fixed height; the phone's whole tab is one scroll column,
         and a control buried below a long roaster list would rarely be
         reachable without scrolling all the way down first). -->
    <div class="seg" :data-pos="diaryState.view === 'full' ? 1 : 0">
      <span class="seg-thumb"></span>
      <button :class="{ on: diaryState.view === 'browse' }" @click="setView('browse')">{{ t('diary.browse') }}</button>
      <button :class="{ on: diaryState.view === 'full' }" @click="setView('full')">{{ t('diary.fullHistory') }}</button>
    </div>

    <button v-if="diaryState.query" class="phone-filter-chip" @click="diaryState.query = ''">
      {{ t('diary.filteredBy', { q: diaryState.query }) }} <span class="x">×</span>
    </button>

    <!-- Full history: flat list across all beans -->
    <div v-if="diaryState.view === 'full'" class="phone-list">
      <button
        v-for="shot in fullHistoryShots"
        :key="shot.id"
        class="phone-shot-row"
        @click="openHistoryAt(fullHistoryShots, shot)"
      >
        <span class="shot-facts">
          <span class="fact"><b>{{ formatShortDate(shot.timestamp) }}</b></span>
          <span class="fact">{{ factsFor(shot).coffeeRoaster }} — {{ factsFor(shot).coffeeName }}</span>
          <span class="fact">{{ factsFor(shot).profileTitle }}</span>
          <span class="fact" v-if="!singleGrinder"><b>{{ factsFor(shot).grinderModel }}</b></span>
          <span class="fact">
            <b>{{ actualDose(shot)?.toFixed(1) ?? '—' }}</b>g<template v-if="metricsFor(shot)"> → <b>{{ metricsFor(shot).yield?.toFixed(1) ?? '—' }}</b>{{ metricsFor(shot).yieldUnit }} (<b>{{ metricsFor(shot).ratio }}</b>)</template>
          </span>
        </span>
        <span class="stars">
          <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" :class="{ on: n <= starLevel(shot) }" aria-hidden="true">
            <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" />
          </svg>
        </span>
      </button>
      <div v-if="!fullHistoryShots.length" class="phone-empty">{{ t('diary.noResults') }}</div>
      <button v-if="hasMoreHistory" class="phone-load-more" :disabled="loadingMore" @click="onLoadMore">
        {{ loadingMore ? t('diary.loading') : t('diary.loadMore', { n: 20 }) }}
      </button>
    </div>

    <!-- Roasters -->
    <div v-else-if="diaryState.level === 0" class="phone-list">
      <button v-for="g in roasterGroups" :key="g.name" class="phone-list-row" @click="enterRoaster(g.name)">
        <span class="rmeta">{{ g.name }}<span class="rsub">{{ g.beans.length }} bean{{ g.beans.length !== 1 ? 's' : '' }}</span></span>
        <span class="chev">›</span>
      </button>
      <div v-if="!roasterGroups.length" class="phone-empty">{{ t('diary.noResults') }}</div>
    </div>

    <!-- Beans in a roaster -->
    <div v-else-if="diaryState.level === 1" class="phone-list">
      <button
        v-for="bean in beansInRoaster" :key="bean.id"
        class="phone-list-row"
        @pointerdown="beanPress.down($event, bean)"
        @pointermove="beanPress.move"
        @pointerup="beanPress.up(bean)"
        @pointercancel="beanPress.cancel"
        @pointerleave="beanPress.cancel"
      >
        <span class="rmeta">{{ bean.name }}</span>
        <span class="chev">›</span>
      </button>
      <div v-if="!beansInRoaster.length" class="phone-empty">{{ t('diary.noResults') }}</div>
    </div>

    <!-- Profiles used with this bean -->
    <div v-else class="phone-list">
      <template v-for="group in profileGroupsInBean" :key="group.title">
        <button
          class="phone-list-row"
          @pointerdown="groupPress.down($event, group)"
          @pointermove="groupPress.move"
          @pointerup="groupPress.up(group)"
          @pointercancel="groupPress.cancel"
          @pointerleave="groupPress.cancel"
        >
          <span class="rmeta">{{ group.title }}</span>
          <span class="chev" :class="{ open: diaryState.expandedProfile === group.title }">›</span>
        </button>
        <div v-if="diaryState.expandedProfile === group.title" class="phone-sublist">
          <button
            v-for="shot in group.shots"
            :key="shot.id"
            class="phone-shot-row"
            @click="openHistoryAt(group.shots, shot)"
          >
            <span class="shot-facts">
              <span class="fact"><b>{{ formatShortDate(shot.timestamp) }}</b></span>
              <span class="fact"><b>{{ actualDose(shot)?.toFixed(1) ?? '—' }}</b>g<template v-if="metricsFor(shot)"> → <b>{{ metricsFor(shot).yield?.toFixed(1) ?? '—' }}</b>{{ metricsFor(shot).yieldUnit }}</template></span>
            </span>
            <span class="stars">
              <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" :class="{ on: n <= starLevel(shot) }" aria-hidden="true">
                <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" />
              </svg>
            </span>
          </button>
        </div>
      </template>
      <div v-if="!profileGroupsInBean.length" class="phone-empty">{{ diaryState.query ? t('diary.noResults') : t('diary.noShotsYet') }}</div>
    </div>

    <PageTransition>
      <RecipePicker
        v-if="showRecipeCreator"
        :preset-bean="diaryState.view === 'browse' && diaryState.level === 2 ? diaryState.bean : null"
        :preset-roaster="diaryState.view === 'browse' && diaryState.level >= 1 ? (diaryState.roasterName || '') : ''"
        @back="closeRecipeCreator"
        @created="onRecipeCreated"
      />
    </PageTransition>
    <PageTransition>
      <BeanEditor
        v-if="showBeanEditor"
        :bean="editingBean"
        :preset-roaster="diaryState.level === 1 ? diaryState.roasterName : ''"
        @close="closeBeanEditor"
        @saved="closeBeanEditor"
        @deleted="closeBeanEditor"
      />
    </PageTransition>
    <PageTransition>
      <BagsPanel v-if="showBags" :bean="bagsBean" @close="closeBags" />
    </PageTransition>
  </section>
</template>
