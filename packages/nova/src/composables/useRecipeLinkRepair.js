/**
 * ONE-OFF MIGRATION — delete this file and its call in main.js once it has run.
 *
 * A recipe points at its bean, grinder, profile, basket and equipment by id,
 * and carries a display string beside each as the fallback for a row that has
 * since been deleted. Recipes written before a given id existed have only the
 * string, and everything built on the id then degrades quietly:
 *
 *   - a rename no longer follows (the whole point of the id), and worse,
 *   - for the bean, recipeMatchesBean falls back to matching roaster+name as
 *     TEXT, so renaming the bean severs the link outright rather than just
 *     staling the label.
 *
 * So: match each missing id back to its library row by name, once, at boot.
 *
 * CONSERVATIVE BY DESIGN. It only ever fills a MISSING id — an existing one is
 * never second-guessed — and only when the name matches exactly one row. An
 * ambiguous name is left alone and counted, because a wrong link is far worse
 * than a missing one: the id wins over the name everywhere downstream, so a
 * mislinked recipe would quietly start brewing someone else's profile.
 */
import { beans, grinders, profiles, baskets, equipment } from './useCore.js';
import { recipes, refreshRecipes } from './useRecipe.js';
import { reportRuntimeError } from './useErrorReporting.js';

const norm = (v) => String(v ?? '').trim().toLowerCase();
const isName = (v) => Boolean(norm(v)) && norm(v) !== '—';

/** The rows whose name matches, so the caller can insist on exactly one. */
function matchesByName(rows, name, nameOf) {
  if (!isName(name)) return [];
  return rows.filter((r) => norm(nameOf(r)) === norm(name));
}

/**
 * The profile a title resolves to — replicating core's buildGatewayPayload
 * rule EXACTLY: a user-owned copy of that title wins over a Decent default,
 * and among user copies the highest version does.
 *
 * Replicated rather than approximated because the stored id, once written,
 * takes precedence over the title everywhere afterwards. Picking a different
 * copy than the title path would have picked wouldn't be a tidy-up — it would
 * silently change which profile the recipe brews.
 */
function resolveProfileByTitle(title) {
  const { NSXCore } = window;
  const isUserOwned = NSXCore.isUserOwnedProfile;
  const byTitle = matchesByName(profiles.value, title, (p) => p.profile?.title);
  if (!byTitle.length) return null;
  const userCopies = byTitle.filter(isUserOwned);
  if (userCopies.length) {
    return userCopies.reduce((best, r) =>
      ((Number(r.profile?.version) || 0) > (Number(best.profile?.version) || 0) ? r : best));
  }
  return byTitle[0];
}

/** Fills what is missing on ONE entry. Returns a patch, or null for nothing. */
function repairEntry(entry, stats) {
  const patch = {};

  if (!entry.beanId && isName(entry.coffeeName)) {
    const hits = beans.value.filter((b) =>
      norm(b.roaster) === norm(entry.coffeeRoaster) && norm(b.name) === norm(entry.coffeeName));
    if (hits.length === 1) { patch.beanId = hits[0].id; stats.bean++; }
    else if (hits.length > 1) stats.ambiguous++;
  }

  if (!entry.grinderId && isName(entry.grinderModel)) {
    const hits = matchesByName(grinders.value, entry.grinderModel, (g) => g.model);
    if (hits.length === 1) { patch.grinderId = hits[0].id; stats.grinder++; }
    else if (hits.length > 1) stats.ambiguous++;
  }

  if (!entry.selectedProfileId && isName(entry.profileTitle)) {
    const found = resolveProfileByTitle(entry.profileTitle);
    if (found?.id) { patch.selectedProfileId = found.id; stats.profile++; }
  }

  // The DYE fields live in one nested object, so a change to either rewrites
  // it whole — built from a copy so an untouched entry is left byte-identical.
  const dye = entry.dye || null;
  if (dye) {
    const nextDye = { ...dye };
    let dyeChanged = false;

    if (!dye.basketId && isName(dye.basketName)) {
      const hits = matchesByName(baskets.value, dye.basketName, (b) => b.name);
      if (hits.length === 1) { nextDye.basketId = hits[0].id; dyeChanged = true; stats.basket++; }
      else if (hits.length > 1) stats.ambiguous++;
    }

    const names = Array.isArray(dye.equipmentNames) ? dye.equipmentNames : [];
    const ids = Array.isArray(dye.equipmentIds) ? [...dye.equipmentIds] : [];
    if (names.length) {
      let equipChanged = false;
      for (let i = 0; i < names.length; i++) {
        if (ids[i]) continue;
        const hits = matchesByName(equipment.value, names[i], (e) => e.name);
        if (hits.length === 1) { ids[i] = hits[0].id; equipChanged = true; stats.equipment++; }
        else if (hits.length > 1) stats.ambiguous++;
      }
      // Only once every slot has an id: a half-filled array would read as the
      // authoritative list (core's equipmentArrays prefers it over the names)
      // and drop whichever pieces are still unmatched.
      if (equipChanged && ids.length === names.length && ids.every(Boolean)) {
        nextDye.equipmentIds = ids;
        nextDye.equipmentNames = [...names];
        dyeChanged = true;
      }
    }

    if (dyeChanged) patch.dye = nextDye;
  }

  return Object.keys(patch).length ? patch : null;
}

/**
 * Runs the repair over the whole library. Safe to run repeatedly — a second
 * run finds nothing, because every id it wrote is now present.
 *
 * @returns {Promise<{changed: number, bean: number, grinder: number,
 *   profile: number, basket: number, equipment: number, ambiguous: number}>}
 */
export async function repairRecipeLinks() {
  const { NSXCore } = window;
  const stats = { changed: 0, bean: 0, grinder: 0, profile: 0, basket: 0, equipment: 0, ambiguous: 0 };
  try {
    const list = await refreshRecipes(true);
    if (!Array.isArray(list) || !list.length) return stats;

    const updated = list.map((entry) => {
      const patch = repairEntry(entry, stats);
      if (!patch) return entry;
      stats.changed++;
      return { ...entry, ...patch };
    });

    // Nothing to write is the normal case on every boot after the first, and
    // writing anyway would churn the store for no reason.
    if (!stats.changed) return stats;

    recipes.value = await NSXCore.saveRecipes(updated);
    console.info('[Nova] recipe links repaired:', stats);
  } catch (err) {
    // A failed repair must never stop the skin from starting: every recipe
    // still works off its stored names, exactly as it did before.
    reportRuntimeError('recipe link repair', err);
  }
  return stats;
}
