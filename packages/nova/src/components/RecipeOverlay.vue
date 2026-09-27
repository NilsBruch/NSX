<script setup>
/**
 * The recipe browser, as a blurred overlay rather than RecipePicker.vue's
 * full-page takeover (RecipePicker still serves the Diary's create flow).
 * Every difference is deliberate, not a simplification:
 *   - the espresso page stays visible (blurred) behind it, so the browser
 *     reads as a layer over the recipe rather than a separate screen;
 *   - the identity title it was opened from stays in the SAME spot, but
 *     splits into three separately-tappable bubbles — that continuity is
 *     what makes "tap the title, then tap the part you want" legible;
 *   - no Back button — tapping the backdrop closes it;
 *   - no create/edit/delete — this is only for switching to another recipe.
 *     Managing the library (deleting, reviewing shots per recipe) is the
 *     Diary's Recipes view; creating one is the Diary's "+".
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { refreshRecipes, selectRecipe, togglePinRecipe, deleteRecipe } from '../composables/useRecipe.js';
import { shots, loadShots, recipeCoffeeName, recipeRoasterName } from '../composables/useCore.js';
import { openChooser, openConfirm } from '../composables/useModals.js';
import { useLongPress } from '../composables/useLongPress.js';
import { skinSettings } from '../composables/useSettings.js';
import { useRecipeList } from '../composables/useRecipeList.js';
import RecipeCard from './RecipeCard.vue';
import RecipeIdentityBubbles from './RecipeIdentityBubbles.vue';

const emit = defineEmits(['close', 'pickBean', 'pickGrinder', 'pickProfile']);
const { t } = useI18n();

// Same reason as RecipePicker: shots are what date a recipe, so the list
// needs them even if the Diary was never opened this session.
onMounted(() => {
  refreshRecipes();
  if (!shots.value.length) loadShots(200).catch(() => { /* unsorted list is still usable */ });
});

const { query, isCurrent, cycleSort, sortLabel, listedRecipes, visibleRecipes, openSearch } = useRecipeList();

/**
 * Nothing in here is hit-testable for the first 400ms.
 *
 * This panel opens from a TAP on the recipe title, and it deliberately places
 * its identity bubbles at that title's own offset so the title "appears to
 * stay put and split" — which puts a button exactly under the finger that
 * just opened it. The browser then delivers that gesture's compatibility
 * mouse events here: useLongPress swallows the click, but :active has already
 * been painted by the mousedown underneath it, so the Grinder bubble visibly
 * depressed on every open.
 *
 * pointer-events: none is the only thing that stops all of it at once — an
 * element that isn't hit-tested is not clicked, not focused and not styled
 * active. 400ms covers the old Android WebView's ~300ms click delay, and the
 * panel is animating in for most of it anyway.
 */
const armed = ref(false);
onMounted(() => { setTimeout(() => { armed.value = true; }, 400); });

async function pick(entry) {
  await selectRecipe(entry);
  emit('close');
}

/**
 * Same gesture as the Diary's profile rows: tap switches to the recipe — that
 * is what this browser is FOR, so it stays one tap — and press-and-hold opens
 * the actions on it. Every card here is a saved recipe, so unlike the Diary all
 * three entries are always available.
 *
 * The overlay closes on Load (the recipe it was browsing away from has
 * changed), but stays open on Pin and Delete: both are list housekeeping, and
 * shutting the list to show the result of tidying it would be backwards.
 */
async function openCardMenu(entry) {
  const choice = await openChooser({
    title: `${recipeRoasterName(entry)} ${recipeCoffeeName(entry)}`,
    options: [
      ['load', t('diary.loadRecipe')],
      ['pin', entry.pinned ? t('diary.unpin') : t('diary.pin')],
      ['delete', t('common.delete')],
    ],
  });
  if (choice === 'load') {
    await pick(entry);
  } else if (choice === 'pin') {
    await togglePinRecipe(entry);
  } else if (choice === 'delete') {
    const ok = await openConfirm({
      title: t('diary.deleteRecipeConfirm'),
      message: `${recipeRoasterName(entry)} – ${recipeCoffeeName(entry)}`,
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) await deleteRecipe(entry.id);
  }
}

const cardPress = useLongPress({ tap: pick, hold: openCardMenu });
</script>

<template>
  <!-- .self so only a tap that lands on the scrim itself closes. The panel is
       pointer-events:none (see app.css), so taps on its empty areas DO land
       here and dismiss; its three interactive sections opt back in. -->
  <div class="rov-scrim" :class="{ 'is-arming': !armed }" @click.self="emit('close')">
    <div class="rov-panel">
      <!-- Sits at the same offset as EspressoView's own .page-title +
           .recipe-identity, so the title the user tapped appears to stay put
           and split rather than being replaced by a new screen. -->
      <div class="page-title">{{ t('espresso.pageTitle') }}</div>

      <RecipeIdentityBubbles
        @pick-bean="emit('pickBean')"
        @pick-grinder="emit('pickGrinder')"
        @pick-profile="emit('pickProfile')"
      />

      <!-- .self: the strip fills the middle of the screen, so the empty bands
           above and below the cards are the strip itself — a tap there
           dismisses, exactly as it does on the panel's other empty space. The
           strip cannot use the panel's pointer-events: none trick for that: it
           is a scroller, and one that isn't hit-testable can't be dragged by
           touch on the tablet. A drag that scrolls never produces a click, so
           this doesn't fire at the end of a swipe. -->
      <div class="rp-strip rov-strip" @click.self="emit('close')">
        <RecipeCard
          v-for="entry in visibleRecipes"
          :key="entry.id"
          :entry="entry"
          :current="isCurrent(entry)"
          @pointerdown="cardPress.down($event, entry)"
          @pointermove="cardPress.move"
          @pointerup="cardPress.up(entry)"
          @pointercancel="cardPress.cancel"
          @pointerleave="cardPress.cancel"
        />

        <!-- Both read from listedRecipes, not the raw library: with every
             recipe's bean archived, "no results" would blame a search nobody
             ran. Nothing to offer is "no recipes yet"; a query that matched
             none of what IS on offer is "no results". -->
        <div v-if="listedRecipes.length && !visibleRecipes.length" class="rp-empty">{{ t('diary.noResults') }}</div>
        <div v-if="!listedRecipes.length" class="rp-empty">{{ t('recipePicker.noRecipesYet') }}</div>
      </div>

      <div class="rp-bottom">
        <button class="sort-btn" @click="cycleSort">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>{{ sortLabel }}
        </button>
        <span class="spacer" style="flex: 1"></span>
        <button v-if="query" class="filter-chip" @click="query = ''">
          {{ t('diary.filteredBy', { q: query }) }}<span class="x">×</span>
        </button>
        <span class="spacer" style="flex: 1"></span>
        <button class="rbtn" :aria-label="t('recipePicker.search')" @click="openSearch">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
        </button>
      </div>
    </div>
  </div>
</template>
