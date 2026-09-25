/**
 * Picking the recipe's kit — its basket and its equipment.
 *
 * A factory, not a module singleton (same convention as useRecipeDials.js):
 * each caller gets its own useI18n() binding, and there is no per-caller state
 * — everything reads and writes the one `recipe` singleton. Both places that
 * offer these pickers call it, so the rules live in one spot:
 *
 *   - the recipe's DYE page (RecipeDyeModal), where they are two of its tiles
 *   - the coffee page's kit chips (RecipeBody), where they are the shortcut
 *
 * Basket is one, equipment is a LIST — a shot is pulled with a scale AND a WDT
 * tool AND a dosing ring — so they take different pickers. Both store the id
 * AND the name (core's dye fields); which of the two is DISPLAYED is the
 * subject of currentName below, and it is not the same answer for a recipe as
 * for a shot.
 */
import { useI18n } from 'vue-i18n';
import { baskets, equipment } from './useCore.js';
import { recipe, setRecipeDye } from './useRecipe.js';
import { openChooser, openMultiChooser } from './useModals.js';
import { reportRuntimeError } from './useErrorReporting.js';

/**
 * The CURRENT name of a library row, falling back to the one stored with the
 * recipe.
 *
 * A recipe stores both the id and the name. The id is the link; the stored
 * name exists so a row that has since been DELETED still reads as something
 * rather than blanking out. Resolving through the library first is what makes
 * a rename show up: rename a basket in Settings — or in DYE2, which we get no
 * write-hook for at all — and every recipe pointing at it follows, because
 * they point at it.
 *
 * A SHOT deliberately does not do this (see ShotDyePage): what it was called
 * when it was pulled is part of what the shot records, and correcting that
 * later would be rewriting history rather than fixing a label.
 */
function currentName(rows, id, stored) {
  const fromLibrary = id ? rows.find((r) => r.id === id)?.name : null;
  return String(fromLibrary || stored || '').trim();
}

/** The recipe's basket, by its current name. `entry` is any recipe record. */
export function recipeBasketName(entry) {
  const d = entry?.dye || {};
  return currentName(baskets.value, d.basketId, d.basketName) || null;
}

/** Its equipment, in the order picked, by their current names. */
export function recipeEquipmentNames(entry) {
  const d = entry?.dye || {};
  const ids = Array.isArray(d.equipmentIds) ? d.equipmentIds : [];
  const names = Array.isArray(d.equipmentNames) ? d.equipmentNames : [];
  const out = [];
  for (let i = 0; i < Math.max(ids.length, names.length); i++) {
    const name = currentName(equipment.value, ids[i], names[i]);
    if (name) out.push(name);
  }
  return out;
}

/** The whole kit as one list — basket first, then each piece. */
export function recipeKitNames(entry) {
  const basket = recipeBasketName(entry);
  return [...(basket ? [basket] : []), ...recipeEquipmentNames(entry)];
}

export function useRecipeKit() {
  const { t } = useI18n();
  const { NSXCore } = window;

  /**
   * DYE2's KV store has no push channel, so the library is only as fresh as
   * the last read. Re-read before opening a picker rather than on some timer:
   * this is the moment it matters, and it is the only moment the user is
   * waiting on it. A failure still opens the picker with whatever is cached —
   * an empty one says "nothing here yet", which is the truth either way.
   */
  async function refreshLibrary() {
    try {
      await NSXCore.loadEquipmentLibrary();
    } catch (err) {
      reportRuntimeError('equipment library', err);
    }
  }

  async function pickBasket() {
    await refreshLibrary();
    const rows = baskets.value;
    const options = [['', t('recipeDye.none')], ...rows.map((r) => [r.id, r.name || '—'])];
    const id = await openChooser({
      title: t('recipeDye.basket'), options, current: recipe.dye?.basketId ?? '',
    });
    if (id == null) return;
    const row = rows.find((r) => r.id === id);
    await setRecipeDye({ basketId: row?.id ?? null, basketName: row?.name ?? null });
  }

  async function pickEquipment() {
    await refreshLibrary();
    const rows = equipment.value;
    const ids = await openMultiChooser({
      title: t('recipeDye.equipment'),
      options: rows.map((r) => [r.id, r.name || '—']),
      current: recipe.dye?.equipmentIds ?? [],
    });
    if (ids == null) return;
    // Mapped back through `rows` rather than trusting the returned order to
    // carry names: the picker deals in ids, the recipe stores both.
    const picked = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    await setRecipeDye({
      equipmentIds: picked.map((r) => r.id),
      equipmentNames: picked.map((r) => r.name ?? null),
    });
  }

  return { pickBasket, pickEquipment, refreshLibrary };
}
