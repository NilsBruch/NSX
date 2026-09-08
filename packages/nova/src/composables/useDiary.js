/**
 * Roaster -> bean -> shots drill-down. Beans/shots come from useCore.js's
 * reactive mirrors of the real bean cache and shot list — no mock data here.
 *
 * Sorting: beans have no created-at field in the real API (only the store's
 * own array order, which is insertion order) — "oldest first" is therefore the
 * list as the API returns it, "newest first" is that reversed, and "A-Z" sorts
 * by name. This is honest to what data actually exists, rather than inventing
 * a fake timestamp. Shots DO have a real `timestamp`, sorted by that instead.
 */
import { computed, reactive, ref, watch } from 'vue';
import { beans, shots, loadShots, shotsFromResponse } from './useCore.js';
import { recipes, refreshRecipes, loadOrCreateRecipeForBeanProfile } from './useRecipe.js';

const { NSXApi, NSXCore } = window;

export const diaryState = reactive({
  level: 0, // 0 = roasters, 1 = beans, 2 = shots
  roasterName: null,
  bean: null,
  sort: 'newest', // 'oldest' | 'newest' | 'alpha' (shots: no 'alpha')
  view: 'browse', // 'browse' | 'full' (flat, all shots) | 'recipes' (the library)
  query: '',
  expandedProfile: null, // which profile group (by title) is expanded, at level 2
  expandedRecipe: null, // which recipe (by id) is expanded, in the recipes view
  editingRecipes: false, // recipes view: reveal the per-row delete
  showArchived: false, // include archived beans in the browse view
});

function sortByNameOrder(items, sort, nameKey = 'name') {
  const arr = items.slice();
  if (sort === 'alpha') arr.sort((a, b) => (a[nameKey] || '').localeCompare(b[nameKey] || ''));
  else if (sort === 'newest') arr.reverse();
  return arr; // 'oldest' = API array order, unchanged
}

const matches = (text, q) => (text || '').toLowerCase().includes(q.trim().toLowerCase());

// bean.js's cache always includes archived beans (it also serves autocomplete) —
// browsing/picking is the skin's concern, so archived beans are hidden by
// default; the Diary's "Show all" toggle (diaryState.showArchived) reveals them.
const activeBeans = computed(() => beans.value.filter((b) => diaryState.showArchived || !b.archived));

/**
 * batchId -> beanId, built from every active bean's real batches (a batch
 * carries the actual `beanId` foreign key — see fetchBatches/fetchBatch in
 * api.js). A shot only ever records `beanBatchId` (which batch it was
 * brewed from), not a bean id directly, so this map is what actually
 * resolves a shot back to its bean; shotMatchesBean below falls back to
 * fuzzy roaster/name string matching only for shots that predate a batch
 * ever being set (e.g. brewed before a roast date was recorded).
 */
export const batchToBean = ref(new Map());

export async function loadBatchMap() {
  const map = new Map();
  await Promise.all(activeBeans.value.map(async (bean) => {
    try {
      const res = await NSXApi.fetchBatches(bean.id, true);
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      for (const batch of list) map.set(batch.id, bean.id);
    } catch {
      // one bean's batches failing to load shouldn't block the others —
      // shots for it just fall back to fuzzy matching below.
    }
  }));
  batchToBean.value = map;
}
watch(beans, loadBatchMap, { immediate: true });

export const roasterGroups = computed(() => {
  const byRoaster = new Map();
  for (const bean of activeBeans.value) {
    const key = bean.roaster || '—';
    if (!byRoaster.has(key)) byRoaster.set(key, []);
    byRoaster.get(key).push(bean);
  }
  let groups = [...byRoaster.entries()].map(([name, list]) => ({ name, beans: list }));
  if (diaryState.query) {
    // A roaster surfaces if ITS OWN name matches, or if any bean under it
    // does — so a bean whose roaster you have forgotten is still reachable
    // from here. Deliberately name-only: profile lives on the SHOT, and the
    // shot list this page has loaded is only the newest 200 across the whole
    // account, so a profile match here could never be more than "whatever
    // happens to be in the window". Profile search belongs where the server
    // can answer it completely — inside a bean, see loadBeanShots.
    const q = diaryState.query;
    groups = groups.filter((g) => matches(g.name, q) || g.beans.some((b) => matches(b.name, q)));
  }
  return sortByNameOrder(groups, diaryState.sort);
});

export const beansInRoaster = computed(() => {
  if (!diaryState.roasterName) return [];
  let list = activeBeans.value.filter((b) => (b.roaster || '—') === diaryState.roasterName);
  if (diaryState.query) list = list.filter((b) => matches(b.name, diaryState.query));
  return sortByNameOrder(list, diaryState.sort);
});

function shotMatchesBean(shot, bean) {
  const beanBatchId = shot?.workflow?.context?.beanBatchId;
  if (beanBatchId && batchToBean.value.has(beanBatchId)) {
    return batchToBean.value.get(beanBatchId) === bean.id;
  }
  // Fallback for shots brewed before this bean ever had a batch/roast date set.
  const ctx = shot?.workflow?.context || {};
  const roaster = (bean.roaster || '').trim().toLowerCase();
  const name = (bean.name || '').trim().toLowerCase();
  return (ctx.coffeeRoaster || '').trim().toLowerCase() === roaster && (ctx.coffeeName || '').trim().toLowerCase() === name;
}
const shotProfile = (shot) => shot?.workflow?.profile?.title || shot?.workflow?.profileTitle || '—';
const byTimestampDesc = (a, b) => (Date.parse(b?.timestamp || 0) || 0) - (Date.parse(a?.timestamp || 0) || 0);

/**
 * Shots for the bean currently drilled INTO — fetched from the server scoped
 * to that bean, so ALL of its shots show, not just the ones that happened to
 * be in the global newest-200. Kept separate from the global `shots` list so
 * the flat full-history view is untouched.
 *
 * Scoped by `beanId` rather than coffeeName + coffeeRoaster: the id is the
 * real key (the server resolves it through the shot's beanBatchId), so a
 * renamed roaster or a spelling variant can no longer split one bean's
 * history in two.
 *
 * `search` is the SAME free-text the gateway applies across coffee name,
 * roaster, profile title, grinder model and notes — case-insensitive
 * substring, verified against the live API. Combined with beanId it ANDs, so
 * typing a profile name inside a bean narrows to that profile's shots across
 * that bean's WHOLE history, not just a client-side window. (profileTitle is
 * also a supported filter, but it matches exactly — no use for typed input.)
 */
export const beanShots = ref([]);
export const beanShotsLoading = ref(false);

export async function loadBeanShots(bean, query = '') {
  if (!bean) { beanShots.value = []; return; }
  beanShotsLoading.value = true;
  try {
    const res = await NSXApi.fetchShots({
      limit: 500,
      beanId: bean.id || '',
      search: query || '',
    });
    beanShots.value = Array.isArray(res) ? res : (res?.items ?? []);
  } catch (err) {
    console.error('[Nova] Diary could not load bean shots', err);
    NSXCore.emit('toast', `Could not load shots: ${err?.message || err}`);
    beanShots.value = [];
  } finally {
    beanShotsLoading.value = false;
  }
}

export const shotsInBean = computed(() => {
  if (!diaryState.bean) return [];
  // Already server-scoped to this bean and server-searched — just apply the sort.
  const list = beanShots.value.slice().sort(byTimestampDesc);
  if (diaryState.sort === 'oldest') list.reverse();
  return list;
});

/** How many shots each bean has, for the bean-list rows — the row can't use
 *  shotsInBean (that's only the bean you've actually drilled INTO, so every
 *  row rendered "0" while still on the list). */
export const shotCountForBean = (bean) => shots.value.filter((s) => shotMatchesBean(s, bean)).length;

/**
 * One entry per profile used with this bean — groups shotsInBean (already
 * sorted) rather than re-deriving from the raw shot list, so diaryState.sort
 * applies here too. Map preserves insertion order, so groups naturally come
 * out "most/least recently used profile first" with no extra ordering logic.
 *
 * Searching at this level is NOT filtered here — the query goes back to the
 * server (loadBeanShots, via the diaryState.query watcher below), which
 * matches profile title among other fields across this bean's whole history.
 * Filtering client-side instead would only ever see the shots already
 * fetched, which is exactly the window problem this level avoids.
 */
export const profileGroupsInBean = computed(() => {
  const byProfile = new Map();
  for (const shot of shotsInBean.value) {
    const title = shotProfile(shot);
    if (!byProfile.has(title)) byProfile.set(title, []);
    byProfile.get(title).push(shot);
  }
  // Each group carries the source shot that a recipe is rebuilt from (its
  // workflow.profile = the real steps actually brewed; its workflow.context =
  // the real dose/grind/yield) — see loadOrCreateRecipeForBeanProfile.
  //
  // The source is the MOST RECENT such shot, picked by timestamp explicitly:
  //  - not list[0] — `list` follows diaryState.sort, so with "oldest first" the
  //    recipe would silently be rebuilt from the oldest shot. Which shot seeds a
  //    recipe must not depend on a UI sort toggle.
  //  - not any shot in the group — shotProfile() groups a shot under EITHER its
  //    own profile.title OR the workflow.profileTitle fallback, so a shot can
  //    land here while its .profile object is something else entirely. Only a
  //    shot whose OWN profile.title equals the group title is a trustworthy
  //    snapshot of "this" profile.
  return [...byProfile.entries()].map(([title, list]) => {
    const source = list
      .filter((s) => s?.workflow?.profile?.title === title)
      .sort(byTimestampDesc)[0] ?? null;
    return {
      title,
      shots: list,
      profile: source?.workflow?.profile ?? null,
      context: source?.workflow?.context ?? null,
    };
  });
});

export function toggleProfileExpanded(title) {
  diaryState.expandedProfile = diaryState.expandedProfile === title ? null : title;
}

/**
 * The recipes view: the whole recipe LIBRARY as a flat list, each row carrying
 * the shots actually brewed with it.
 *
 * Sourced from `recipes` (the library) rather than from shots the way
 * profileGroupsInBean is — that difference is the point of this view. A recipe
 * that has never been brewed still belongs in a library you manage, and
 * `rating` is a property of the recipe itself, so it only exists on this side.
 *
 * NSXCore.findShotsForWorkflow matches on the shared workflow key (roaster /
 * bean / grinder / profile) and returns newest-first, so the expanded shot
 * list needs no ordering of its own.
 */
export const recipeRows = computed(() => {
  const q = diaryState.query.trim().toLowerCase();
  // Most-recently-brewed first is the base order, and stays the tiebreak under
  // 'rating' so equally-rated recipes still lead with the one you actually use.
  let list = NSXCore.sortRecipesByLastUsed(recipes.value, shots.value);
  if (q) {
    list = list.filter((r) =>
      [r.coffeeRoaster, r.coffeeName, r.profileTitle, r.grinderModel].some((v) => matches(v, q))
    );
  }
  if (diaryState.sort === 'rating') {
    const pos = new Map(list.map((r, i) => [r, i]));
    list = list.slice().sort((a, b) =>
      ((Number(b.rating) || 0) - (Number(a.rating) || 0)) || (pos.get(a) - pos.get(b))
    );
  }
  return list.map((recipe) => ({ recipe, shots: NSXCore.findShotsForWorkflow(recipe, shots.value) }));
});

// The recipes view sorts by its own two axes, not the shared date/A-Z set:
// a recipe has no meaningful "created" date, and its useful orderings are how
// often you reach for it and how well it scored.
const RECIPE_SORTS = ['use', 'rating'];

export function toggleRecipeExpanded(id) {
  diaryState.expandedRecipe = diaryState.expandedRecipe === id ? null : id;
}
export function toggleEditingRecipes() {
  diaryState.editingRecipes = !diaryState.editingRecipes;
}

/**
 * Per-shot ACTUAL metrics (measured output + brew time + real ratio), keyed by
 * shot id. The list endpoint's lightweight shot carries no measurements, so —
 * exactly like NSX's _loadHistoryShotDurations — these come from fetching the
 * FULL shot (NSXCore.getShotDetails is per-id cached, so revisiting never
 * refetches) and running the shared resolvers over it:
 *   - yield  = resolveActualYield (annotation → volume snapshot → scale sample)
 *   - ratio  = actual dose : actual yield (not the planned recipe targets)
 *   - durationSec = getShotDurationSeconds
 * Actual dose (resolveActualDose) needs no full shot — it reads an annotation
 * with a target fallback — so the view derives it straight from the list shot.
 * Bounded concurrency keeps the flat full-history (up to 200 rows) from firing
 * a request storm on open.
 */
export const shotMetrics = reactive(new Map()); // id -> { yield, yieldUnit, estimated, ratio, durationSec, spark } | null
const _metricsQueued = new Set();
const _metricsQueue = [];
let _metricsActive = 0;
const METRICS_CONCURRENCY = 6;

function _computeMetrics(full) {
  const y = NSXCore.resolveActualYield(full);
  const dose = NSXCore.resolveActualDose(full);
  const ratio = dose && y.value ? NSXCore.calcRatio(dose, y.value) : '—';
  return {
    yield: y.value, yieldUnit: y.unit, estimated: y.estimated, ratio,
    durationSec: NSXCore.getShotDurationSeconds(full),
    // The row's thumbnail plot, reduced HERE rather than in the component:
    // this full shot is already in hand for the metrics above and is the only
    // place the measurements exist (the list endpoint omits them). Keeping the
    // shot itself would mean holding a few thousand samples per row alive for
    // the life of the list; forty normalised numbers per series is the whole
    // cost of the plot, and no extra request is made for it.
    spark: NSXCore.buildShotSparkline(full),
  };
}

function _pumpMetrics() {
  while (_metricsActive < METRICS_CONCURRENCY && _metricsQueue.length) {
    const id = _metricsQueue.shift();
    _metricsActive += 1;
    NSXCore.getShotDetails(id)
      .then((full) => shotMetrics.set(id, _computeMetrics(full)))
      .catch(() => shotMetrics.set(id, null))
      .finally(() => { _metricsActive -= 1; _pumpMetrics(); });
  }
}

export function ensureShotMetrics(list) {
  for (const shot of list || []) {
    const id = shot?.id;
    if (!id || shotMetrics.has(id) || _metricsQueued.has(id)) continue;
    _metricsQueued.add(id);
    _metricsQueue.push(id);
  }
  _pumpMetrics();
}

/**
 * Tapping a profile entry (not one of its shots) loads the bean+profile as a
 * recipe on the Espresso screen — an EXISTING recipe if one already matches,
 * or a freshly-created one if this profile was only ever brewed some other way
 * (not through Nova's recipe picker, so no persisted entity exists yet).
 * Navigation itself stays in DiaryView.vue; this only loads/creates+loads.
 */
export async function openRecipeForBeanProfile(bean, profileTitle, fallbackProfile = null, fallbackContext = null) {
  await loadOrCreateRecipeForBeanProfile(bean, profileTitle, fallbackProfile, fallbackContext);
}

/**
 * The flat full-history browse: its OWN paged query, not a view over the
 * recent-shots reference list in useCore.js. It has to be, because it is the
 * one shot list the user can both search and page through — writing those
 * results into the shared ref left every other consumer (per-bean counts,
 * "last brewed" sorting) reading a filtered, or arbitrarily long, list.
 *
 * `historyTotal` is what the server reports for the CURRENT query, so "are
 * there more?" stays correct under a search as well as without one.
 */
const historyPage = ref([]);
const historyTotal = ref(0);

/** Replace the history with a fresh page 0, optionally server-side searched.
 *  The gateway's free-text covers coffee name, roaster, profile title, grinder
 *  model and notes, so this searches the WHOLE history, not the loaded page. */
export async function loadHistory(query = '') {
  const { items, total } = shotsFromResponse(await NSXApi.fetchShots({ limit: 200, offset: 0, search: query }));
  historyPage.value = items;
  historyTotal.value = total;
}

/** Append the next page, keeping whatever search is active. De-dupes by id so
 *  an overlapping page (a shot recorded between requests shifts the window)
 *  cannot list the same shot twice. */
export async function loadMoreHistory(pageSize = 20) {
  const { items, total } = shotsFromResponse(
    await NSXApi.fetchShots({ limit: pageSize, offset: historyPage.value.length, search: diaryState.query || '' })
  );
  const seen = new Set(historyPage.value.map((s) => s.id));
  historyPage.value = [...historyPage.value, ...items.filter((s) => !seen.has(s.id))];
  historyTotal.value = total;
}

/** Re-run the current history query, but only if that list is what's on screen
 *  — for the two places a shot appears or disappears out from under it (a brew
 *  finishing, a shot deleted in the review). While the full history shared the
 *  reference list, useLiveShot.js's loadShots(200) covered both for free. */
export async function refreshHistoryIfActive() {
  if (diaryState.view !== 'full') return;
  await loadHistory(diaryState.query || '');
}

// No client-side text filter here: the server already applied the query, so
// results are never limited to the page in memory. Just apply the sort toggle.
export const fullHistoryShots = computed(() => {
  const list = historyPage.value.slice().sort(byTimestampDesc);
  if (diaryState.sort === 'oldest') list.reverse();
  return list;
});

/** True when the server reports more shots than are currently loaded — drives
 *  the full-history "Load more" button. */
export const hasMoreHistory = computed(() => historyPage.value.length < historyTotal.value);

/**
 * Route the search box to the server where the data isn't fully in memory:
 *  - full history view: re-query all shots with the search term
 *  - inside a bean (level 2): re-query that bean's shots with the term
 * The roaster/bean-name levels stay client-side — bean names come from the
 * complete bean cache, so there's nothing more to fetch there.
 */
let _queryTimer = null;
watch(
  () => diaryState.query,
  (q) => {
    clearTimeout(_queryTimer);
    _queryTimer = setTimeout(() => {
      // The recipes view filters the in-memory library client-side, so it
      // deliberately falls through both branches. The `view === 'browse'`
      // guard matters: level/bean survive a view switch, so without it typing
      // here would re-query the last-browsed bean's shots.
      if (diaryState.view === 'full') loadHistory(q || '');
      else if (diaryState.view === 'browse' && diaryState.level === 2 && diaryState.bean) loadBeanShots(diaryState.bean, q || '');
    }, 250);
  }
);

export function enterRoaster(name) {
  diaryState.roasterName = name;
  diaryState.bean = null;
  diaryState.level = 1;
  // Query deliberately NOT cleared here (unlike enterBean below): a roaster
  // can surface at level 0 because one of its BEANS matched, not its own
  // name — that is how you find a bean whose roaster you have forgotten.
  // Clearing on the way in would drop that filter exactly when it is about to
  // do its job, leaving you to spot the bean by eye. Both levels search names,
  // so the term stays meaningful; level 2 is a different domain and does clear.
}
export function enterBean(bean) {
  diaryState.bean = bean;
  diaryState.level = 2;
  // Cleared on the way in: the roaster/bean list searches NAMES, this level
  // searches SHOTS (server-side, see loadBeanShots) — two different question
  // domains, so carrying the name you typed upstairs into a shot query would
  // usually just empty the list. Type again here to search this bean's shots.
  diaryState.query = '';
  diaryState.expandedProfile = null;
  if (diaryState.sort === 'alpha') diaryState.sort = 'newest'; // alpha has no meaning for shots
  loadBeanShots(bean); // fetch ALL of this bean's shots from the server
}
export function goBack() {
  if (diaryState.level === 2) { diaryState.level = 1; diaryState.bean = null; diaryState.expandedProfile = null; }
  else if (diaryState.level === 1) { diaryState.level = 0; diaryState.roasterName = null; }
  diaryState.query = '';
}
export function cycleSort() {
  // `level` survives a view switch, so it only means anything while browsing —
  // without that guard the recipes view would inherit a stale level 2.
  const shotLevel = diaryState.view === 'full' || (diaryState.view === 'browse' && diaryState.level === 2);
  const opts = diaryState.view === 'recipes' ? RECIPE_SORTS
    : shotLevel ? ['oldest', 'newest']
    : ['oldest', 'newest', 'alpha'];
  const i = opts.indexOf(diaryState.sort);
  diaryState.sort = opts[(i + 1) % opts.length];
}
export function setView(view) {
  diaryState.view = view;
  diaryState.query = '';
  // Each view owns its own data now, so switching cannot leave another view
  // reading a filtered list — but the history's own ref does need filling,
  // both on first entry and to drop a search made on a previous visit.
  if (view === 'full') loadHistory('');
  diaryState.expandedRecipe = null;
  diaryState.editingRecipes = false; // never leave a destructive mode armed across views
  // `sort` is shared, but the recipes view's vocabulary doesn't overlap the
  // others' at all — so translate on the way in and back out, or a stale value
  // would leave the sort button labelled for a mode this view can't apply.
  if (view === 'recipes') {
    if (!RECIPE_SORTS.includes(diaryState.sort)) diaryState.sort = 'use';
  } else if (RECIPE_SORTS.includes(diaryState.sort)) {
    diaryState.sort = 'newest';
  }
  if (view === 'full' && diaryState.sort === 'alpha') diaryState.sort = 'newest';
}
export function toggleArchived() {
  diaryState.showArchived = !diaryState.showArchived;
}

/**
 * Diary previously relied entirely on bootCore()'s one-shot `loadShots(200)`
 * (inside a `Promise.allSettled`, so a failed/slow fetch there just left the
 * full-history view silently empty forever, with no retry). Diary now owns
 * its own load, like every other lazily-opened panel already does.
 */
export async function ensureDiaryLoaded() {
  // refreshRecipes feeds the recipes view — the library is a separate store
  // read from shots/beans, and nothing else on this page loads it.
  // diaryState survives unmounting (module-level), so the Diary can re-open
  // straight into the full history — which owns its own list and would
  // otherwise mount empty until the user switched views and back.
  const [shotsResult] = await Promise.allSettled([
    loadShots(200), loadBatchMap(), refreshRecipes(), refreshHistoryIfActive(),
  ]);
  // A failed fetch previously left the list silently empty with no signal at
  // all — surface it the same way every other load failure in Nova does.
  if (shotsResult.status === 'rejected') {
    console.error('[Nova] Diary could not load shots', shotsResult.reason);
    NSXCore.emit('toast', `Could not load shot history: ${shotsResult.reason?.message || shotsResult.reason}`);
  }
}
