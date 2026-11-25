/**
 * "Create recipes from past shots": the user's way to turn coffees they have
 * brewed — on another skin, or before the recipe library existed — into saved
 * recipes. Nova only SUGGESTS: it lists every bean + grinder + profile that has
 * shots but no recipe (core's recipeCandidatesFromShots) and creates exactly
 * the ones the user ticks. Recipes are never created behind the user's back.
 *
 * Offered ONCE automatically (offerRecipesFromShotsOnce, when the Diary opens;
 * the gateway-stored flag below makes that once across devices), and always
 * available from Settings → General.
 */
import i18n from '../i18n/index.js';
import { recipes, refreshRecipes } from './useRecipe.js';
import { beans, grinders, formatGrinderLabel, profilesAll, refreshProfilesAll, boot } from './useCore.js';
import { openMultiChooser } from './useModals.js';
import { showToast } from './useToast.js';
import { loadBatchMap } from './useDiary.js';

const { NSXCore, NSXApi } = window;
const t = (...args) => i18n.global.t(...args);

const OFFERED_KEY = 'nova_recipesFromShotsOffered';
const PAGE = 500;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The bean's WHOLE shot history, paged — a combination brewed long ago is
 *  exactly the one most likely to have no recipe. */
async function fetchAllShots() {
  const all = [];
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const res = await NSXApi.fetchShots({ limit: PAGE, offset });
    const items = Array.isArray(res) ? res : (res?.items ?? []);
    all.push(...items);
    if (items.length < PAGE) break;
  }
  return all;
}

/**
 * What could be created: each candidate with the bean and library profile it
 * would reference. A combination whose coffee is no bean in the library, or
 * whose profile is gone from it, is left out — such a recipe could not be
 * brewed (recipes reference library profiles only).
 */
async function findCandidates() {
  // The bag -> bean map first: candidates are matched against existing recipes
  // by bean id through the shot's bag (core's isSameRecipe), and it is also how
  // a shot of a since-renamed bean finds that bean below.
  await Promise.all([refreshRecipes(true), loadBatchMap()]);
  if (!profilesAll.value.length) await refreshProfilesAll();
  const shots = await fetchAllShots();
  const picks = NSXCore.recipeCandidatesFromShots(shots, recipes.value);
  return picks.map((shot) => {
    const wf = NSXCore.mapShotToWorkflow(shot);
    // A shot stores the coffee's name AS BREWED; its bag still knows the bean
    // after a rename. A bag that's gone (bean deleted) falls back to the name.
    const viaBag = NSXCore.beanIdForBatch(shot?.workflow?.context?.beanBatchId);
    const bean = (viaBag && beans.value.find((b) => b.id === viaBag))
      || beans.value.find((b) => same(b.roaster, wf.coffeeRoaster) && same(b.name, wf.coffeeName));
    const pid = shot?.workflow?.profileId;
    const profile = (pid && profilesAll.value.find((p) => p.id === pid))
      || profilesAll.value.find((p) => (p.profile?.title || '') === wf.profileTitle);
    if (!bean || !profile) return null;
    const g = wf.grinderId ? grinders.value.find((x) => x.id === wf.grinderId) : null;
    const grinder = g ? formatGrinderLabel(g) : (wf.grinderModel !== '—' ? wf.grinderModel : null);
    const n = NSXCore.findShotsForWorkflow(wf, shots).length;
    const label = [`${bean.roaster} ${bean.name}`, grinder, wf.profileTitle].filter(Boolean).join(' · ')
      + ` (${t('recipeSuggest.shots', { n }, n)})`;
    return { shot, bean, profile, label, wf: { ...wf, coffeeRoaster: bean.roaster, coffeeName: bean.name } };
  }).filter(Boolean)
    // Re-check under the bean's CURRENT name: after a rename, a suggestion can
    // equal a recipe that already exists, or another suggestion.
    .filter(function unique(c) {
      this.seen = this.seen || [...recipes.value];
      if (NSXCore.findMatchingRecipe(this.seen, c.wf)) return false;
      this.seen.push(c.wf);
      return true;
    }, {});
}

/**
 * List the unsaved combinations and create the ticked ones. Nothing is ticked
 * up front — the user chooses. Resolves the number created.
 */
export async function offerRecipesFromShots({ quietIfNone = false } = {}) {
  const candidates = await findCandidates();
  if (!candidates.length) {
    if (!quietIfNone) showToast(t('recipeSuggest.none'));
    return 0;
  }
  const picked = await openMultiChooser({
    title: t('recipeSuggest.title'),
    options: candidates.map((c, i) => [String(i), c.label]),
  });
  if (!picked?.length) return 0;
  const entries = picked.map((i) => candidates[Number(i)]).map((c) => ({
    ...NSXCore.recipeEntryFromShot(c.shot, { id: NSXCore.makeRecipeId(), beanId: c.bean.id, profileId: c.profile.id }),
    // The bean's CURRENT name, not the one on the (older) shot — so the recipe
    // matches the shots brewed from now on.
    coffeeRoaster: c.bean.roaster,
    coffeeName: c.bean.name,
    dye: NSXCore.normalizeDye(null),
  }));
  recipes.value = await NSXCore.saveRecipes([...recipes.value, ...entries]);
  showToast(t('recipeSuggest.created', { n: entries.length }, entries.length));
  return entries.length;
}

/** The one automatic offer (the Diary calls it on open). The flag is set
 *  BEFORE asking, so dismissing it counts as answered; Settings keeps the
 *  action for later. Silent when there is nothing to suggest. */
export async function offerRecipesFromShotsOnce() {
  if (!boot.done || NSXCore.getStore()[OFFERED_KEY]) return;
  NSXCore.patchStore({ [OFFERED_KEY]: true });
  try {
    await offerRecipesFromShots({ quietIfNone: true });
  } catch (err) {
    console.warn('[Nova] could not suggest recipes from past shots', err?.message || err);
  }
}
