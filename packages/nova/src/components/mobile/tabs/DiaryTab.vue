<script setup>
/**
 * Phone "Diary" — the same bag -> profile -> shot drill-down as DiaryView.vue
 * (same composable, same state), plus its flat full-history toggle, reflowed
 * into a single scrolling column instead of the tablet's fixed page chrome.
 * Recipe library management has its own phone tab (RecipesTab.vue).
 *
 * MobileShell.vue keeps diaryState.view off 'recipes' while this tab is
 * active (see the comment there) — this file toggles between 'batches' and
 * 'full'.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  diaryState, fullHistoryShots,
  goBack, cycleSort, setView, ensureDiaryLoaded,
  toggleProfileExpanded, openRecipeForBeanProfile,
  shotMetrics, ensureShotMetrics, hasMoreHistory, loadMoreHistory,
  batchRows, batchProfileGroups, enterBatch, loadBatchMap,
} from '../../../composables/useDiary.js';
import { findRecipeForBeanProfile, togglePinRecipe, deleteRecipe } from '../../../composables/useRecipe.js';
import { toggleArchiveBean, confirmAndDeleteBean, confirmAndDeleteBatch, toggleArchiveBatch } from '../../../composables/useBeanActions.js';
import { openTextField, openChooser, openConfirm } from '../../../composables/useModals.js';
import { openHistoryAt } from '../../../composables/useLiveShot.js';
import { singleGrinder, formatShortDate, formatLongDate, recipeCoffeeName, recipeRoasterName } from '../../../composables/useCore.js';
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
 * four icon buttons, which leaves "bean › roast date" a few characters
 * before it ellipsises into nothing.
 */
const crumb = computed(() => (diaryState.view === 'full' ? t('diary.fullHistory') : t('diary.batches')));

const path = computed(() => {
  const open = diaryState.view === 'batches' ? diaryState.batch : null;
  if (!open) return '';
  const date = !open.batch ? t('diary.noBag')
    : open.batch.roastDate ? formatLongDate(open.batch.roastDate) : t('diary.noRoastDate');
  return `${open.bean.name} › ${date}`;
});
const showBack = computed(() => diaryState.view === 'batches' && !!diaryState.batch);
const searchPlaceholder = computed(() => {
  if (diaryState.view === 'full') return t('diary.searchProfile');
  return diaryState.batch ? t('diary.searchProfile') : t('diary.searchRoaster');
});
const sortLabel = computed(() => t(`diary.sort${diaryState.sort[0].toUpperCase()}${diaryState.sort.slice(1)}`));

// History's rating filter — the same choices as the tablet's (DiaryView.vue).
async function openRatingFilter() {
  const options = [[0, t('diary.allRatings')], ...[1, 2, 3, 4, 5].map((n) => [n, t('diary.minStars', { n })])];
  const choice = await openChooser({ title: t('diary.ratingFilter'), options, current: diaryState.minStars });
  if (choice != null) diaryState.minStars = Number(choice);
}

async function openSearch() {
  const value = await openTextField({ title: t('diary.search'), value: diaryState.query, placeholder: searchPlaceholder.value });
  if (value !== null) diaryState.query = value;
}

const starLevel = (shot) => window.NSXCore.enjoymentToStars(shot?.annotations?.enjoyment);
const factsFor = (shot) => window.NSXCore.mapShotToWorkflow(shot);
const actualDose = (shot) => window.NSXCore.resolveActualDose(shot);
const metricsFor = (shot) => shotMetrics.get(shot.id) || null;

// "Edit bean" from a bag row's menu.
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

// Profile-group row: tap expands the shot history below it — unlike the
// tablet's profile row, which taps straight to loading the recipe.
// Hold adds the same Load / Pin / Delete the tablet's openGroupMenu offers.
// Load routes to the phone's Recipes tab rather than router.push({name:
// 'espresso'}) — the phone has no router navigation of its own (usePhoneNav.js).
// Profile rows belong to the opened bag's coffee — the same rule as the
// tablet's groupBean/groupBatch (DiaryView.vue): from an OPEN bag the recipe
// brews from that bag, otherwise from the coffee's open bag.
const groupBean = () => diaryState.batch?.bean;
const groupBatch = () => {
  const bag = diaryState.batch?.batch;
  return bag && !bag.archived ? bag : null;
};
function savedRecipeForGroup(group) {
  return findRecipeForBeanProfile(groupBean(), group.title);
}
async function loadGroupRecipe(group) {
  try {
    await openRecipeForBeanProfile(groupBean(), group.title, group.profile, group.context, groupBatch());
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

// Bag rows: tap opens the bag, hold offers the coffee's menu plus Done/Reopen.
// The tablet also has Done as a button on the row; a phone row is one button
// already, so here it lives in the menu only.
function bagFacts(row) {
  const { batch, bean } = row;
  const roast = !batch ? t('diary.noBag')
    : batch.roastDate ? t('diary.roastedOn', { date: formatShortDate(batch.roastDate) }) : t('diary.noRoastDate');
  return [bean.roaster, roast].filter(Boolean).join(' · ');
}
function bagLabel(batch) {
  return batch?.roastDate ? t('diary.roastedOn', { date: formatLongDate(batch.roastDate) }) : t('diary.noRoastDate');
}
async function toggleBagDone(row) {
  try {
    await toggleArchiveBatch(row.batch);
    row.batch.archived = !row.batch.archived;
    await loadBatchMap();
  } catch (err) {
    window.NSXCore.emit('toast', err?.message || String(err));
  }
}
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
  else if (choice === 'done') await toggleBagDone(row);
  else if (choice === 'deleteBag') { if (await confirmAndDeleteBatch(batch)) await loadBatchMap(); }
  else if (choice === 'archive') await toggleArchiveBean(bean);
  else if (choice === 'delete') await confirmAndDeleteBean(bean);
}
const bagPress = useLongPress({ tap: enterBatch, hold: openBagMenu });

// Metrics for whatever's expanded once a bean is drilled into, or for the
// flat full-history list once that's the active view.
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
      <button v-if="showBack" class="phone-back" :aria-label="t('diary.back')" @click="goBack">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span class="phone-crumb">{{ crumb }}</span>
      <button
        v-if="diaryState.view === 'full'"
        class="sort-btn icon-only"
        :class="{ accent: diaryState.minStars > 0 }"
        :aria-label="t('diary.ratingFilter')"
        @click="openRatingFilter"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" /></svg>
      </button>
      <button v-if="diaryState.view !== 'batches'" class="sort-btn icon-only" :aria-label="sortLabel" @click="cycleSort">
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

    <!-- Batches/History toggle sits right under the header, not at the foot of
         a scrolling list (the tablet can pin it to the page bottom because
         .page has a fixed height; the phone's whole tab is one scroll column,
         and a control buried below a long bag list would rarely be
         reachable without scrolling all the way down first). -->
    <div class="seg" :data-pos="diaryState.view === 'full' ? 1 : 0">
      <span class="seg-thumb"></span>
      <button :class="{ on: diaryState.view === 'batches' }" @click="setView('batches')">{{ t('diary.batches') }}</button>
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

    <!-- Batches: one row per bag, then an opened bag's recipes — the same
         lists as the tablet (batchRows / batchProfileGroups in useDiary.js). -->
    <div v-else-if="!diaryState.batch" class="phone-list">
      <button
        v-for="row in batchRows" :key="row.key"
        class="phone-list-row"
        :class="{ archived: row.batch?.archived }"
        @pointerdown="bagPress.down($event, row)"
        @pointermove="bagPress.move"
        @pointerup="bagPress.up(row)"
        @pointercancel="bagPress.cancel"
        @pointerleave="bagPress.cancel"
      >
        <span class="rmeta">{{ row.bean.name }}<span class="rsub">{{ bagFacts(row) }}</span></span>
        <span class="chev">›</span>
      </button>
      <div v-if="!batchRows.length" class="phone-empty">{{ t('diary.noResults') }}</div>
    </div>

    <div v-else class="phone-list">
      <template v-for="(list, half) in [batchProfileGroups.current, batchProfileGroups.earlier]" :key="half">
        <div v-if="half === 1 && list.length" class="diary-divider">{{ t('diary.earlierBags') }}</div>
        <template v-for="group in list" :key="group.title">
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
            <template v-for="section in group.sections" :key="section.id ?? 'none'">
              <div v-if="!section.current" class="diary-divider">{{ bagLabel(section.batch) }}</div>
              <button
                v-for="shot in section.shots"
                :key="shot.id"
                class="phone-shot-row"
                @click="openHistoryAt(group.ordered, shot)"
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
            </template>
          </div>
        </template>
      </template>
      <div v-if="!batchProfileGroups.current.length && !batchProfileGroups.earlier.length" class="phone-empty">{{ diaryState.query ? t('diary.noResults') : t('diary.noShotsYet') }}</div>
    </div>

    <PageTransition>
      <RecipePicker
        v-if="showRecipeCreator"
        :preset-bean="diaryState.view === 'batches' && diaryState.batch ? diaryState.batch.bean : null"
        :preset-batch="diaryState.view === 'batches' && diaryState.batch?.batch && !diaryState.batch.batch.archived ? diaryState.batch.batch : null"
        @back="closeRecipeCreator"
        @created="onRecipeCreated"
      />
    </PageTransition>
    <PageTransition>
      <BeanEditor
        v-if="showBeanEditor"
        :bean="editingBean"
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
