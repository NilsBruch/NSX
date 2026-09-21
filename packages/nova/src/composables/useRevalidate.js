/**
 * Cross-device revalidation for the data Nova only ever fetches once.
 *
 * Nova had no equivalent of NSX's setupCrossDeviceRefresh/revalidateOpenViews
 * (packages/nsx/src/modules/app.js) at all: nothing in the skin re-fetches
 * recipes, profiles, beans, grinders, or shots after boot. Two tablets on the
 * same gateway would silently drift — device A's new recipe never appearing on
 * device B without a full page reload — and worse, saveRecipes' 3-way merge
 * (packages/core/src/domains/workflow.js) bases itself on whatever this device
 * last saw, so an hours-stale device B can overwrite a same-recipe edit device
 * A made in the meantime, with no warning.
 *
 * This re-fetches the shared lists on natural "the user might be looking at
 * fresh data now" moments (see wireRevalidateTriggers below). Each fetch goes
 * through the core's ETag layer (packages/core/src/api.js's getWithEtag): an
 * unchanged list comes back as a 304 with the SAME object reference, so
 * assigning it to a ref is a no-op for Vue's reactivity — nothing re-renders
 * unless something actually changed. Revalidating often is therefore cheap;
 * the throttle below exists only to bound how often we round-trip at all, not
 * because a wasted round-trip would visibly cost anything.
 *
 * Deliberately NOT included: NSXCore.loadStore() (skin settings/presets).
 * store.js's replaceStore() swaps the whole reactive settings object, which
 * would yank a slider out from under a mid-drag edit. That needs its own,
 * more careful pass — see the plan.
 */
import { boot, refreshProfiles, loadShots } from './useCore.js';
import { refreshRecipes, loadRecipeShots } from './useRecipe.js';

const { NSXCore } = window;

const THROTTLE_MS = 10_000;
let lastRunAt = 0;

/**
 * Re-fetch every shared list a background refresh cannot silently corrupt.
 * Safe to call as often as you like — throttled internally, and every fetch
 * is allSettled so one failing endpoint (e.g. the gateway briefly offline)
 * never stops the others or throws into the caller.
 */
export async function revalidateSharedData() {
  if (!boot.done) return; // nothing to revalidate before the first load has happened
  const now = Date.now();
  if (now - lastRunAt < THROTTLE_MS) return;
  lastRunAt = now;

  // loadShots is unconditional: it refreshes the recent-shots reference list,
  // which no view writes a search into any more (useCore.js / useDiary.js's
  // historyPage). This used to need a guard against clobbering an on-screen
  // full-history search — and that guard, in turn, preserved the filtered list
  // for every other view. Neither problem exists now.
  await Promise.allSettled([
    refreshRecipes(true),
    refreshProfiles(true),
    NSXCore.loadBeans(),
    NSXCore.loadGrinders(),
    loadShots(200),
    // The loaded recipe's own (gateway-queried) history — a shot pulled on
    // another device belongs in it just as much as in the reference list.
    loadRecipeShots(),
  ]);
}

/**
 * Call once, after bootCore() has resolved. Wires the two natural revalidation
 * moments on a kiosk-style app that rarely fully unmounts:
 *  - visibilitychange / focus: the tablet was woken, or the browser tab
 *    resumed — mirrors NSX's setupCrossDeviceRefresh.
 *  - router:revalidate (emitted by router/index.js's afterEach, and by
 *    MobileShell.vue's phone-tab watcher, since the phone layout does not
 *    navigate through vue-router): every view switch is a moment the user is
 *    about to look at a list this device may not have fetched in a while.
 */
export function wireRevalidateTriggers() {
  const maybeRevalidate = () => {
    if (document.visibilityState !== 'visible') return;
    revalidateSharedData();
  };
  document.addEventListener('visibilitychange', maybeRevalidate);
  window.addEventListener('focus', maybeRevalidate);
  window.addEventListener('router:revalidate', () => revalidateSharedData());
}
