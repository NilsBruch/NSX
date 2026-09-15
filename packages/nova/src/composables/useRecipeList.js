import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { recipe, recipes, beanForRecipe, justCreatedRecipeId, selectRecipe, setRecipeTags, allRecipeTags } from './useRecipe.js';
import { shots } from './useCore.js';
import { openTextField } from './useModals.js';

/**
 * The recipe library's query/sort/filter state — shared by RecipeOverlay.vue
 * (the quick-switch browser) and RecipeBrowser.vue (the coffee page's graph
 * layout), so both list the same recipes the same way without one copying the
 * other's filtering rules.
 *
 * A factory, not a module singleton: each caller gets its own `query` /
 * `sortMode`, since the overlay and the browser can in principle be open at
 * once (the overlay is reachable from the browser's identity-less cards via
 * RecipeBody's own "open-recipes" -> RecipeOverlay) and must not share one
 * search box between them.
 */
export function useRecipeList() {
  const { t } = useI18n();

  const query = ref('');
  const sortMode = ref('use');

  const isCurrent = (entry) => entry.id != null && entry.id === recipe.id;

  function cycleSort() { sortMode.value = sortMode.value === 'use' ? 'rating' : 'use'; }
  const sortLabel = computed(() => t(sortMode.value === 'rating' ? 'recipePicker.sortRating' : 'recipePicker.sortUse'));

  const sortedRecipes = computed(() => {
    const byRecency = window.NSXCore.sortRecipesByLastUsed(recipes.value, shots.value);
    // A never-brewed recipe has no shot to date it, so the recency sort above
    // leaves it in its original order at the end (see its own comment). For a
    // recipe just CREATED in this session that means being buried the moment
    // it's saved, so surface it at the very top while it's still the loaded
    // one. Only that one (justCreatedRecipeId) — keying this on "loaded and
    // unbrewed" instead made any older never-brewed recipe jump to the top of
    // the list the moment it was tapped, under the user's own finger. It falls
    // back to plain recency the moment something else is loaded, or it's
    // actually brewed (which gives it a real timestamp).
    const currentIdx = byRecency.findIndex((r) =>
      r.id != null && r.id === justCreatedRecipeId.value
      && window.NSXCore.findShotsForWorkflow(r, shots.value).length === 0
    );
    const byUse = currentIdx <= 0 ? byRecency : (() => {
      const copy = byRecency.slice();
      const [current] = copy.splice(currentIdx, 1);
      copy.unshift(current);
      return copy;
    })();
    const sorted = sortMode.value !== 'rating' ? byUse : (() => {
      const pos = new Map(byUse.map((r, i) => [r, i]));
      return byUse.slice().sort((a, b) =>
        ((Number(b.rating) || 0) - (Number(a.rating) || 0)) || (pos.get(a) - pos.get(b))
      );
    })();
    // Pinned first, in whatever order the active sort gave them — a partition,
    // not another sort key, so pinning never reshuffles anything among itself and
    // the sort button still visibly does what it says within each half.
    return [...sorted.filter((r) => r.pinned), ...sorted.filter((r) => !r.pinned)];
  });

  /**
   * Archiving a bean in the Diary is how a coffee leaves the rotation without
   * losing its history — so its recipes leave this list with it, otherwise the
   * quick-switch browser keeps offering coffees that are finished.
   *
   * The loaded recipe is the one exception: it is what the machine is holding
   * right now, and a browser that omits the thing you are actually brewing (badge
   * and all) reads as a bug. Archiving is reversible and deliberately soft —
   * unlike deletion, which takes the recipes outright.
   */
  const listedRecipes = computed(() =>
    sortedRecipes.value.filter((entry) => isCurrent(entry) || !beanForRecipe(entry)?.archived)
  );

  const visibleRecipes = computed(() => {
    const q = query.value.trim().toLowerCase();
    if (!q) return listedRecipes.value;
    return listedRecipes.value.filter((entry) =>
      [entry.coffeeRoaster, entry.coffeeName, entry.profileTitle, entry.grinderModel]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  });

  /**
   * Recipe tags — the labels that ride along in the pushed workflow and get
   * stamped onto every shot pulled on it (see useRecipe's `tags`). Reuses the
   * text field's tag mode, the same editor the bean's tasting notes use,
   * seeded with every tag the library already has so spellings stay
   * consistent.
   *
   * Lives here rather than in each hold menu because both browsers offer it
   * and the rule is identical: tags are a property of the LOADED recipe (that
   * is the one whose workflow is on the machine), so editing them on another
   * card loads it first — the same thing the menus' other editing entries do.
   * Called with no entry (RecipeBody's tag chip) it edits the loaded recipe
   * directly, which is already the one on the machine.
   */
  async function editTags(entry = null) {
    if (entry && !isCurrent(entry)) await selectRecipe(entry);
    const value = await openTextField({
      title: t('espresso.tags'),
      value: (recipe.tags || []).join(', '),
      placeholder: t('espresso.tagsPlaceholder'),
      tags: true,
      suggestions: allRecipeTags.value,
    });
    if (value === null) return;
    await setRecipeTags(value.split(',').map((v) => v.trim()).filter(Boolean));
  }

  async function openSearch() {
    const value = await openTextField({ title: t('recipePicker.search'), value: query.value, placeholder: t('recipePicker.searchPlaceholder') });
    if (value !== null) query.value = value;
  }

  return { query, sortMode, isCurrent, cycleSort, sortLabel, sortedRecipes, listedRecipes, visibleRecipes, openSearch, editTags };
}
