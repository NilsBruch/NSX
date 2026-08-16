<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  diaryState, roasterGroups, beansInRoaster, shotsInBean, fullHistoryShots,
  enterRoaster, enterBean, goBack, cycleSort, setView, toggleArchived, ensureDiaryLoaded, shotCountForBean,
  profileGroupsInBean, toggleProfileExpanded, openRecipeForBeanProfile,
  shotMetrics, ensureShotMetrics, hasMoreShots, loadMoreFullHistory,
} from '../composables/useDiary.js';
import { openHistoryAt } from '../composables/useLiveShot.js';
import { openTextField } from '../composables/useModals.js';
import { singleGrinder } from '../composables/useCore.js';
import BeanEditor from '../components/BeanEditor.vue';
import RecipePicker from '../components/RecipePicker.vue';

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
// RecipePicker owns both steps already; entering at 'bean' just skips its library list.
const showRecipeCreator = ref(false);
function closeRecipeCreator() { showRecipeCreator.value = false; }
async function onRecipeCreated() {
  await ensureDiaryLoaded(); // the new bean/bag should show up in the Diary immediately
  router.push({ name: 'espresso' }); // the new recipe is now loaded — go brew it
}

onMounted(ensureDiaryLoaded);

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

// enjoyment is 0-100 in the real API (5 stars x 20), not 1-5 (see
// enjoymentToStars). Rendered as 5 individual SVG stars rather than a single
// '★★★☆☆' text string — a hollow ☆ glyph colored the same as a filled ★ read
// as barely distinguishable at this size; the SVG's empty state gets its own
// stroke so "not rated" is unambiguous even glanced at from across the room.
const starLevel = (shot) => window.NSXCore.enjoymentToStars(shot?.annotations?.enjoyment);

// The lightweight list-endpoint shot (what fullHistoryShots/shotsInBean hold)
// carries workflow.context/profile but not measurements — mapShotToWorkflow
// (core) is exactly the fields derivable from that: roaster, bean, dose,
// grind, profile, and a ready-formatted temp/ratio. Brew time is deliberately
// NOT shown here: it only exists in a shot's full measurements, and fetching
// those per row for a 200-shot list isn't worth the request storm — it's
// already shown once a shot is opened (LiveShotOverlay's history screen).
const factsFor = (shot) => window.NSXCore.mapShotToWorkflow(shot);

// Actual dose reads an annotation (target fallback) off the LIGHT shot — no
// fetch needed, so it shows immediately. Actual yield/ratio/duration only exist
// in the full shot record (fetched lazily + cached — see ensureShotMetrics),
// so those render once it arrives.
const actualDose = (shot) => window.NSXCore.resolveActualDose(shot);
const metricsFor = (shot) => shotMetrics.get(shot.id) || null;
function durationLabel(shot) {
  const sec = metricsFor(shot)?.durationSec;
  return Number.isFinite(sec) ? `${Math.round(sec)}s` : '';
}
// Fetch metrics for whatever shots are actually on screen: the flat full
// history, or the shots under the one expanded profile group.
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

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
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
        <span class="shot-body">
          <span class="shot-facts">
            <span class="fact"><b>{{ fmtDate(shot.timestamp) }}</b></span>
            <span class="fact">{{ factsFor(shot).coffeeRoaster }}</span>
            <span class="fact">{{ factsFor(shot).coffeeName }}</span>
          </span>
          <span class="shot-meta">
            <span class="rp-chip">{{ factsFor(shot).profileTitle }}</span>
            <span>{{ factsFor(shot).profileTemp }}</span>
            <span v-if="!singleGrinder"><b>{{ factsFor(shot).grinderModel }}</b></span>
            <span>{{ t('espresso.grindSize') }} <b>{{ factsFor(shot).grinderSetting }}</b></span>
            <span>
              <b>{{ actualDose(shot)?.toFixed(1) ?? '—' }}</b>g<template v-if="metricsFor(shot)"> → <b>{{ metricsFor(shot).yield?.toFixed(1) ?? '—' }}</b>{{ metricsFor(shot).yieldUnit }}{{ metricsFor(shot).estimated ? '*' : '' }}
              (<b>{{ metricsFor(shot).ratio }}</b>)<template v-if="durationLabel(shot)">{{ ' ' + t('diary.in') + ' ' }}<b>{{ durationLabel(shot) }}</b></template></template>
            </span>
          </span>
        </span>
        <span class="stars">
          <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" :class="{ on: n <= starLevel(shot) }" aria-hidden="true">
            <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" />
          </svg>
        </span>
      </button>
      <div v-if="!fullHistoryShots.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
      <button v-if="hasMoreShots" class="load-more" :disabled="loadingMore" @click="onLoadMore">
        {{ loadingMore ? t('diary.loading') : t('diary.loadMore', { n: 20 }) }}
      </button>
    </div>

    <!-- Browse: roasters -->
    <div v-else-if="diaryState.level === 0" class="list">
      <button v-for="g in roasterGroups" :key="g.name" class="list-row" @click="enterRoaster(g.name)">
        <span class="rmeta">{{ g.name }}<span class="rsub">{{ g.beans.length }} bean{{ g.beans.length !== 1 ? 's' : '' }}</span></span>
        <span class="chev">›</span>
      </button>
      <div v-if="!roasterGroups.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
    </div>

    <!-- Browse: beans in a roaster -->
    <div v-else-if="diaryState.level === 1" class="list">
      <div v-for="bean in beansInRoaster" :key="bean.id" class="list-row bean-row">
        <button class="row-main" @click="enterBean(bean)">
          <span class="rmeta">{{ bean.name }}</span>
          <span class="chev">›</span>
        </button>
        <button class="row-edit" :aria-label="t('diary.editBean')" @click="openEditBean(bean)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z" /></svg>
        </button>
      </div>
      <div v-if="!beansInRoaster.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
    </div>

    <!-- Browse: profiles used with this bean, one entry each -->
    <div v-else class="list">
      <template v-for="group in profileGroupsInBean" :key="group.title">
        <div class="list-row bean-row">
          <button class="row-main" @click="toggleProfileExpanded(group.title)">
            <span class="rmeta">{{ group.title }}</span>
          </button>
          <button class="row-edit" :aria-label="t('diary.expandProfile')" @click="toggleProfileExpanded(group.title)">
            <span class="chev" :class="{ open: diaryState.expandedProfile === group.title }">›</span>
          </button>
          <button class="load-recipe-btn" @click="goToRecipe(group)">{{ t('diary.loadRecipe') }}</button>
        </div>
        <div v-if="diaryState.expandedProfile === group.title" class="sublist">
          <button
            v-for="shot in group.shots"
            :key="shot.id"
            class="list-row shot-row as-btn"
            @click="openHistoryAt(group.shots, shot)"
          >
            <span class="shot-body">
              <span class="shot-facts">
                <span class="fact"><b>{{ fmtDate(shot.timestamp) }}</b></span>
                <span class="fact"><b>{{ actualDose(shot)?.toFixed(1) ?? '—' }}</b>g<template v-if="metricsFor(shot)"> → <b>{{ metricsFor(shot).yield?.toFixed(1) ?? '—' }}</b>{{ metricsFor(shot).yieldUnit }}{{ metricsFor(shot).estimated ? '*' : '' }}</template></span>
              </span>
              <!-- Roaster/bean/profile are already the context you drilled into
                   (this list is nested under one bean's one profile) — repeating
                   them here would just be noise. Grinder, grind setting, temp and
                   ratio are the facts that still vary shot to shot. -->
              <span class="shot-meta">
                <span>{{ factsFor(shot).profileTemp }}</span>
                <span v-if="!singleGrinder"><b>{{ factsFor(shot).grinderModel }}</b></span>
                <span>{{ t('espresso.grindSize') }} <b>{{ factsFor(shot).grinderSetting }}</b></span>
                <span v-if="metricsFor(shot)">(<b>{{ metricsFor(shot).ratio }}</b>)<template v-if="durationLabel(shot)">{{ ' ' + t('diary.in') + ' ' }}<b>{{ durationLabel(shot) }}</b></template></span>
              </span>
            </span>
            <span class="stars">
              <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" :class="{ on: n <= starLevel(shot) }" aria-hidden="true">
                <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" />
              </svg>
            </span>
          </button>
        </div>
      </template>
      <div v-if="!profileGroupsInBean.length" class="list-row"><span class="rsub">{{ t('diary.noShotsYet') }}</span></div>
    </div>

    <div class="diary-bottom">
      <div class="seg" :data-pos="diaryState.view === 'full' ? 1 : 0">
        <span class="seg-thumb"></span>
        <button :class="{ on: diaryState.view === 'browse' }" @click="setView('browse')">{{ t('diary.browse') }}</button>
        <button :class="{ on: diaryState.view === 'full' }" @click="setView('full')">{{ t('diary.fullHistory') }}</button>
      </div>
      <span class="spacer" style="flex: 1"></span>
      <button v-if="diaryState.query" class="filter-chip" @click="clearQuery">
        {{ t('diary.filteredBy', { q: diaryState.query }) }}
        <span class="x" :aria-label="t('diary.clearFilter')">×</span>
      </button>
      <span class="spacer" style="flex: 1"></span>
      <button
        v-if="diaryState.view === 'browse'"
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
      start-step="bean"
      @back="closeRecipeCreator"
      @created="onRecipeCreated"
    />
  </section>
</template>
