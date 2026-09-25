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
 * tool AND a dosing ring — so they take different pickers. Both store the NAME
 * beside the id (core's dye fields): a card can then render without resolving
 * the library, and a shot still reads correctly once the row behind it is
 * deleted.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { baskets, equipment } from './useCore.js';
import { recipe, setRecipeDye } from './useRecipe.js';
import { openChooser, openMultiChooser } from './useModals.js';
import { reportRuntimeError } from './useErrorReporting.js';

/** The kit as text — basket first, then each piece, in the order picked. */
export const recipeKitNames = computed(() => {
  const d = recipe.dye || {};
  return [d.basketName, ...(Array.isArray(d.equipmentNames) ? d.equipmentNames : [])]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
});

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
