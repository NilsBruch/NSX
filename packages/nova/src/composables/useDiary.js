/**
 * The Diary: bags -> a coffee's recipes -> shots, plus the flat history and
 * the recipe library. Beans/shots come from useCore.js's reactive mirrors of
 * the real bean cache and shot list — no mock data here.
 */
import { computed, reactive, ref, watch } from 'vue';
import { beans, shots, loadShots, shotsFromResponse } from './useCore.js';
import { recipes, refreshRecipes, loadOrCreateRecipeForBeanProfile } from './useRecipe.js';

const { NSXApi, NSXCore } = window;

export const diaryState = reactive({
  sort: 'newest', // 'oldest' | 'newest' (full history) | 'use' | 'rating' (recipes)
  // The Diary opens on Batches (what is open right now).
  view: 'batches', // 'batches' | 'full' (flat, all shots) | 'recipes' (the library)
  query: '',
  expandedProfile: null, // which profile group (by title) is expanded, in an opened bag
  expandedRecipe: null, // which recipe (by id) is expanded, in the recipes view
  editingRecipes: false, // recipes view: reveal the per-row delete
  minStars: 0, // full history: only shots rated at least this many stars (0 = all)
  batch: null, // batches view: the bag drilled into ({ batch, bean }), or null = the list
});

const matches = (text, q) => (text || '').toLowerCase().includes(q.trim().toLowerCase());

// bean.js's cache always includes archived beans (it also serves autocomplete) —
// browsing is the skin's concern, so the Diary leaves archived beans out; they
// stay reachable in the bean manager.
const activeBeans = computed(() => beans.value.filter((b) => !b.archived));

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
/** The same fetch, kept whole: every bag of every active bean, archived bags
 *  included, as { batch, bean } — what the Batches view lists. */
export const allBatches = ref([]);
/** False until the first loadBatchMap finishes — see batchRows. */
const batchMapLoaded = ref(false);

export async function loadBatchMap() {
  const map = new Map();
  const pairs = [];
  await Promise.all(activeBeans.value.map(async (bean) => {
    try {
      const res = await NSXApi.fetchBatches(bean.id, true);
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      for (const batch of list) { map.set(batch.id, bean.id); pairs.push({ batch, bean }); }
    } catch {
      // one bean's batches failing to load shouldn't block the others —
      // shots for it just fall back to fuzzy matching below.
    }
  }));
  batchToBean.value = map;
  allBatches.value = pairs;
  batchMapLoaded.value = true;
}
watch(beans, loadBatchMap, { immediate: true });

/** Does this shot come from that bean? Exported because the recipe wizard's
 *  bean step asks the same question to work out which beans were brewed most
 *  recently (BeanChooser.vue). */
export function shotMatchesBean(shot, bean) {
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
 * Shots for the coffee of the bag opened — fetched from the server scoped
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

export async function loadBeanShots(bean, query = '') {
  if (!bean) { beanShots.value = []; return; }
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
  }
}

/**
 * One entry per profile in `shotList` (newest first), in the order the
 * profiles were last used — Map preserves insertion order, so that needs no
 * extra ordering logic.
 *
 * Searching is NOT filtered here — the query goes back to the server
 * (loadBeanShots, via the diaryState.query watcher below), which matches
 * profile title among other fields across the coffee's whole history.
 * Filtering client-side instead would only ever see the shots already
 * fetched.
 */
function groupShotsByProfile(shotList) {
  const byProfile = new Map();
  for (const shot of shotList) {
    const title = shotProfile(shot);
    if (!byProfile.has(title)) byProfile.set(title, []);
    byProfile.get(title).push(shot);
  }
  // Each group carries the source shot that a recipe is rebuilt from (its
  // workflow.profile = the real steps actually brewed; its workflow.context =
  // the real dose/grind/yield) — see loadOrCreateRecipeForBeanProfile.
  //
  // The source is the MOST RECENT such shot, picked by timestamp explicitly:
  //  - not list[0] — that only holds while every caller passes newest-first
  //    shots, and which shot seeds a recipe must not depend on a caller's order.
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
}

/**
 * The Batches view: one row per bag, because a bag (one bean, one roast date)
 * is what is actually on the counter. Open bags first, then archived ("done")
 * bags greyed at the end.
 *
 * Within each half the order is "brewed most recently", read from the shared
 * recent-shots list — that list is the newest ~200 only, so a bag last brewed
 * before that window ranks like a never-brewed one and falls back to its roast
 * date (newest roast first). Good enough to put the bags in use on top without
 * a request per bag just to sort.
 *
 * The search box filters by bean or roaster name, client-side: the bag list is
 * complete in memory.
 *
 * A bean with no bag at all gets a row of its own (`batch: null`), placed with
 * the open bags — otherwise a coffee that was never given a bag would have no
 * way into the Diary at all.
 * Only once the bag map has loaded: before that EVERY bean reads as bagless.
 */
export const batchRows = computed(() => {
  const lastShot = new Map();
  for (const s of shots.value) {
    const id = s?.workflow?.context?.beanBatchId;
    const ts = Date.parse(s?.timestamp || 0) || 0;
    if (id && ts > (lastShot.get(id) || 0)) lastShot.set(id, ts);
  }
  let rows = allBatches.value.map(({ batch, bean }) => ({ key: batch.id, batch, bean, lastShot: lastShot.get(batch.id) || 0 }));
  if (batchMapLoaded.value) {
    const bagged = new Set(allBatches.value.map((p) => p.bean.id));
    for (const bean of activeBeans.value) {
      if (bagged.has(bean.id)) continue;
      const last = shots.value
        .filter((s) => shotMatchesBean(s, bean))
        .reduce((max, s) => Math.max(max, Date.parse(s?.timestamp || 0) || 0), 0);
      rows.push({ key: `bean-${bean.id}`, batch: null, bean, lastShot: last });
    }
  }
  if (diaryState.query) {
    const q = diaryState.query;
    rows = rows.filter((r) => matches(r.bean.name, q) || matches(r.bean.roaster, q));
  }
  const roast = (r) => NSXCore.normalizeRoastDate(r.batch?.roastDate) || '';
  return rows.sort((a, b) =>
    (Number(!!a.batch?.archived) - Number(!!b.batch?.archived))
    || (b.lastShot - a.lastShot)
    || roast(b).localeCompare(roast(a))
    // Last resort, so ties (e.g. undated, never-brewed bags) keep one order:
    // allBatches is filled in whatever order the per-bean fetches finish, and
    // the row animation would otherwise shuffle them on every reload.
    || String(a.key).localeCompare(String(b.key))
  );
});

/**
 * A bag opened: the recipes of its COFFEE, not just of this bag — every
 * profile ever brewed with this bean, so all of a coffee's recipes are in one
 * place. Built from beanShots (server-scoped by beanId, the whole history).
 *
 * Split in two so the bag on the counter still leads:
 *   current — profiles brewed with THIS bag, most recently used first
 *   earlier — profiles only ever brewed with older bags of the coffee
 * A bean with no bag has nothing to split by, so everything is `current`.
 *
 * Each group's shots come in `sections`, one per bag: this bag's first, then
 * the older bags in the order they were last brewed. The view draws a divider
 * with the roast date above every section that is not this bag. `ordered` is
 * the same shots flattened in display order — what the shot review pages
 * through, so swiping follows the list on screen.
 */
export const batchProfileGroups = computed(() => {
  const open = diaryState.batch;
  if (!open) return { current: [], earlier: [] };
  const batchId = open.batch?.id ?? null;
  const bagOf = new Map(allBatches.value.map((p) => [p.batch.id, p.batch]));
  const groups = groupShotsByProfile(beanShots.value.slice().sort(byTimestampDesc)).map((group) => {
    const byBag = new Map();
    for (const s of group.shots) {
      const id = s?.workflow?.context?.beanBatchId ?? null;
      if (!byBag.has(id)) byBag.set(id, []);
      byBag.get(id).push(s);
    }
    const sections = [...byBag.entries()]
      .map(([id, list]) => ({ id, current: !!batchId && id === batchId, batch: bagOf.get(id) ?? null, shots: list }))
      // Array sort is stable: past the current bag, the most-recent-first
      // order the Map was filled in stays.
      .sort((a, b) => Number(b.current) - Number(a.current));
    return { ...group, sections, ordered: sections.flatMap((s) => s.shots) };
  });
  if (!batchId) return { current: groups, earlier: [] };
  const inBag = (g) => g.sections.some((s) => s.current);
  return { current: groups.filter(inBag), earlier: groups.filter((g) => !inBag(g)) };
});

export function enterBatch(row) {
  diaryState.batch = row;
  diaryState.query = ''; // the list searched bean names; inside, the query searches shots
  diaryState.expandedProfile = null;
  beanShots.value = [];
  loadBeanShots(row.bean);
}

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
export async function openRecipeForBeanProfile(bean, profileTitle, fallbackProfile = null, fallbackContext = null, batch = null) {
  await loadOrCreateRecipeForBeanProfile(bean, profileTitle, fallbackProfile, fallbackContext, batch);
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

/** Which way the SERVER should sort, from the view's sort toggle. The history
 *  is paged, so this is not cosmetic: the gateway orders before it pages, so
 *  the direction decides WHICH shots page 0 contains. Reversing a page in the
 *  browser instead showed the oldest of the newest 200 — the true oldest shot
 *  was never fetched at all. */
const historyOrder = () => (diaryState.sort === 'oldest' ? 'asc' : 'desc');
/** The rating filter, also applied by the SERVER (GET /shots' minEnjoyment),
 *  for the same reason as the sort: filtering a page in the browser would only
 *  ever find the good shots among the 200 already loaded. */
const historyMinEnjoyment = () => NSXCore.starsToEnjoyment(diaryState.minStars);

/** Replace the history with a fresh page 0, optionally server-side searched.
 *  The gateway's free-text covers coffee name, roaster, profile title, grinder
 *  model and notes, so this searches the WHOLE history, not the loaded page. */
export async function loadHistory(query = '') {
  const { items, total } = shotsFromResponse(
    await NSXApi.fetchShots({
      limit: 200, offset: 0, search: query, order: historyOrder(), minEnjoyment: historyMinEnjoyment(),
    })
  );
  historyPage.value = items;
  historyTotal.value = total;
}

/** Append the next page, keeping whatever search is active. De-dupes by id so
 *  an overlapping page (a shot recorded between requests shifts the window)
 *  cannot list the same shot twice. */
export async function loadMoreHistory(pageSize = 20) {
  const { items, total } = shotsFromResponse(
    await NSXApi.fetchShots({
      limit: pageSize, offset: historyPage.value.length,
      search: diaryState.query || '', order: historyOrder(), minEnjoyment: historyMinEnjoyment(),
    })
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

// Neither a text filter NOR a sort here: the server applied both, so results
// are never limited to the page in memory and the page is already in the right
// order. Re-sorting locally is what made "Load more" append at the TOP — the
// next page is older, and a client-side ascending sort floated it above
// everything already on screen, away from the button that asked for it.
//
// The rating filter is the exception, applied here AS WELL as on the server: a
// gateway from before minEnjoyment (decaid < Oct 30 2026) accepts the
// parameter and ignores it, so without this the list reloads unchanged. On a
// current gateway every row already passes. historyPage stays unfiltered, so
// "Load more" keeps paging by what the server returned.
export const fullHistoryShots = computed(() => {
  const min = historyMinEnjoyment();
  if (!(min > 0)) return historyPage.value;
  return historyPage.value.filter((s) => {
    const e = s?.annotations?.enjoyment;
    return e != null && Number(e) >= min;
  });
});

/** True when the server reports more shots than are currently loaded — drives
 *  the full-history "Load more" button. */
export const hasMoreHistory = computed(() => historyPage.value.length < historyTotal.value);

/**
 * Route the search box to the server where the data isn't fully in memory:
 *  - full history view: re-query all shots with the search term
 *  - inside a bag: re-query its coffee's shots with the term
 * The bag list stays client-side — bean names come from the complete bean
 * cache, so there's nothing more to fetch there.
 */
let _queryTimer = null;
watch(
  () => diaryState.query,
  (q) => {
    clearTimeout(_queryTimer);
    _queryTimer = setTimeout(() => {
      // The recipes view filters the in-memory library client-side, so it
      // deliberately falls through both branches.
      if (diaryState.view === 'full') loadHistory(q || '');
      else if (diaryState.view === 'batches' && diaryState.batch) loadBeanShots(diaryState.batch.bean, q || '');
    }, 250);
  }
);

/**
 * The full history's sort is a SERVER query, so flipping it has to re-fetch —
 * every other list in the Diary holds all its rows and can just re-order in
 * place. Only that view: the recipes list sorts what it already has, and a
 * fetch there would be pure waste.
 *
 * The reload also drops back to page 0, which is the honest thing to do: the
 * pages loaded so far were the newest N, and "oldest first" is a different set
 * of shots, not the same set upside down.
 */
watch(
  () => diaryState.sort,
  () => { if (diaryState.view === 'full') loadHistory(diaryState.query || ''); }
);
// The rating filter is a server query too, so it reloads the same way.
watch(
  () => diaryState.minStars,
  () => { if (diaryState.view === 'full') loadHistory(diaryState.query || ''); }
);

export function goBack() {
  diaryState.batch = null;
  diaryState.expandedProfile = null;
  diaryState.query = '';
}
export function cycleSort() {
  const opts = diaryState.view === 'recipes' ? RECIPE_SORTS : ['oldest', 'newest'];
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
  diaryState.batch = null;
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
