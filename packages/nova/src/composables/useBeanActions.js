/**
 * Deleting a bean, as one function rather than one per entry point.
 *
 * It is not a one-liner: the confirmation has to say how many recipes go with
 * the bean, and the recipes have to be removed BEFORE the bean (so a gateway
 * that refuses the delete never leaves recipes pointing at a bean that is
 * still there). Any second copy of that sequence would get one of those wrong
 * eventually — which is exactly what nearly happened when the Diary's rows
 * grew their own delete beside the editor's.
 *
 * This file used to claim "the bridge cascades the bean's batches on its own".
 * It does not — see NSXCore.deleteBean, which now clears them itself.
 */
import i18n from '../i18n/index.js';
import { openConfirm } from './useModals.js';
import { recipesUsingBean, deleteRecipesUsingBean, refreshRecipes } from './useRecipe.js';

const { NSXCore } = window;
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
