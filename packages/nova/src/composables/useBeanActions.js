/**
 * Bean AND bag (batch) flows that touch the gateway plus a confirm dialog, as
 * one function per flow rather than one per entry point.
 *
 * The bean-delete sequence is not a one-liner: the confirmation has to say how
 * many recipes go with the bean, and the recipes have to be removed BEFORE the
 * bean (so a gateway that refuses the delete never leaves recipes pointing at
 * a bean that is still there). Any second copy of that sequence would get one
 * of those wrong eventually — which is exactly what nearly happened when the
 * Diary's rows grew their own delete beside the editor's.
 *
 * This file used to claim "the bridge cascades the bean's batches on its own".
 * It does not — see NSXCore.deleteBean, which now clears them itself.
 *
 * The batch functions call NSXApi directly rather than through NSXCore: core
 * exposes no batch mutators at all (`packages/core/src/domains/bean.js`
 * documents a batch's roastDate as immutable, by design — see setBatchRoastDate
 * below for why the Diary's Bags panel is a deliberate, called-out exception to
 * that), and nova already reaches NSXApi's batch endpoints directly elsewhere
 * (useRecipe.js's gcBatchIfUnused/adoptBatch). Adding core wrappers that would
 * only forward to NSXApi buys no shared logic — NSX has its own bean-manager
 * batch code in its own idiom already.
 */
import i18n from '../i18n/index.js';
import { openConfirm } from './useModals.js';
import { recipesUsingBean, deleteRecipesUsingBean, refreshRecipes } from './useRecipe.js';

const { NSXCore, NSXApi } = window;
const t = (...args) => i18n.global.t(...args);

/**
 * Flip a bean's archived flag — the softer alternative the delete dialog points
 * at. The whole record is sent back with the one field changed, not a
 * `{archived}` patch: the gateway's PUT replaces the bean, so a partial body
 * would quietly drop its origin, variety, process and notes.
 *
 * The Diary hides archived beans unless "Show all" is on, so the row this was
 * invoked from is expected to disappear — that IS the feedback.
 */
export async function toggleArchiveBean(bean) {
  if (!bean?.id) return false;
  const archived = !bean.archived;
  await NSXCore.updateBean(bean.id, { ...bean, archived });
  await NSXCore.loadBeans();
  return archived;
}

/** Asks, then deletes. Resolves true only if the bean is actually gone. */
export async function confirmAndDeleteBean(bean) {
  if (!bean?.id) return false;

  // Re-read the library first: the count is what the user decides on, so it
  // must not come from a cache another device may have moved on from.
  await refreshRecipes().catch(() => { /* fall back to what's cached */ });
  const affected = recipesUsingBean(bean);

  const ok = await openConfirm({
    title: affected.length
      ? t('diary.deleteBeanAndRecipes', { n: affected.length }, affected.length)
      : t('diary.deleteBeanConfirm'),
    message: t('diary.deleteBeanArchiveHint'),
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (!ok) return false;

  if (affected.length) await deleteRecipesUsingBean(bean);
  try {
    await NSXCore.deleteBean(bean.id);
  } catch (err) {
    // What the gateway says when it refuses is a raw SQLite foreign-key dump —
    // true, and useless to the person holding the tablet. Say what it means and
    // point at the way out the dialog already offered, keeping the original on
    // the console for whoever is actually debugging.
    console.error('[Nova] bean delete refused by the gateway', err);
    NSXCore.emit('toast', t('diary.deleteBeanFailed'));
    await NSXCore.loadBeans();
    return false;
  }
  await NSXCore.loadBeans();
  return true;
}

/**
 * A new bag for a bean already in the library — the Diary Bags panel's own
 * "Add bag" (useRecipe.js's ensureRecipeBatch/resolveBatch cover the OTHER way
 * a bag gets created, implicitly, off a recipe's roast date). The caller
 * reloads the batch list; this function only writes.
 */
export async function addBatch(beanId, roastDateIso) {
  if (!beanId) return null;
  return NSXApi.createBatch(beanId, { roastDate: roastDateIso });
}

/**
 * Edits a bag's roast date IN PLACE — the one deliberate exception to
 * bean.js's documented rule that a batch's roastDate is immutable. That rule
 * exists because every past shot pulled from a bag reports the bag's
 * roastDate at read time, so rewriting it retroactively changes what those
 * shots say. The Bags panel offers this anyway, as a correction tool for a
 * mistyped date — it surfaces the caveat itself (a toast,
 * beanManager.roastDateWarning, right as the date picker for an EXISTING bag
 * opens) rather than hiding it behind a plain-looking date field.
 *
 * Sends the batch's OTHER fields back unchanged (weight/price/roastLevel/…) —
 * whether the gateway's batch PUT merges or replaces is unverified either way
 * in this repo, and the whole-record body is correct under both readings.
 * `id`/`createdAt`/`updatedAt` are left out: a strict gateway can reject a
 * body that tries to set columns it considers server-owned.
 */
export async function setBatchRoastDate(batch, iso) {
  if (!batch?.id) return null;
  const { id, createdAt, updatedAt, ...rest } = batch;
  return NSXApi.updateBatch(batch.id, { ...rest, roastDate: iso });
}

/**
 * Asks, then deletes a bag — warning by name when shots still reference it
 * (those shots are NOT touched; useDiary.js's shotMatchesBean already falls
 * back to roaster/name matching for a shot whose batch link has gone stale).
 * Deliberately does NOT use nova's own `shots` ref for the count: that ref is
 * capped to the newest ~200 shots (see useCore.js), so an older bag would
 * silently read as "0 shots" and this would delete on a false premise. One
 * extra fetchShots call, scoped to just this bag, is the honest way to know.
 */
export async function confirmAndDeleteBatch(batch) {
  if (!batch?.id) return false;

  let shotCount = null; // null = unknown shape/failed — see below
  try {
    const res = await NSXApi.fetchShots({ beanBatchId: batch.id, limit: 1 });
    if (!Array.isArray(res)) shotCount = Number.isFinite(res?.total) ? res.total : null;
  } catch (err) {
    console.warn('[Nova] could not check this bag\'s shot count', err?.message);
  }

  const ok = await openConfirm({
    title: shotCount
      ? t('beanManager.deleteBatchWithShots', { n: shotCount }, shotCount)
      : (shotCount === 0 ? t('beanManager.deleteBatchConfirm') : t('beanManager.deleteBatchUnknownShots')),
    message: shotCount ? t('beanManager.deleteBatchHint') : '',
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (!ok) return false;

  await NSXApi.deleteBatch(batch.id);
  return true;
}
