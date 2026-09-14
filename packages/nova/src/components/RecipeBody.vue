<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders, recipeIdentityParts, formatShortDate } from '../composables/useCore.js';
import { recipe, roastAge, pushRecipe, setRecipeRating } from '../composables/useRecipe.js';
import { loadHistoryForCurrentRecipe } from '../composables/useLiveShot.js';
import { openNumberPad, openRating } from '../composables/useModals.js';
import { useDragDial, DIAL_PX_PER_STEP } from '../composables/useDragDial.js';
import StarRating from './StarRating.vue';
import RecipeIdentityBubbles from './RecipeIdentityBubbles.vue';

/**
 * The single-recipe editor: identity title, the three dose/grind/yield+temp
 * dials, and the Edit profile / Rate / History row. Used both as the classic
 * coffee page (EspressoView.vue, showHistory true) and, unchanged, as the
 * "Edit Recipe" overlay over the graph browser (RecipeBrowser.vue's mode,
 * showHistory false) — so the dials and their drag/tap wiring exist in
 * exactly one place no matter which layout is on screen.
 *
 * showHistory also decides which identity control renders where the combined
 * title normally sits: true (classic page) keeps the single tappable
 * .recipe-title bar that opens the full RecipeOverlay browser; false (the
 * Edit Recipe overlay) swaps it for the same three separate Bean/Grinder/
 * Profile bubbles RecipeOverlay itself uses, so each can be picked directly
 * without detouring through that browser. The two conditions always coincide
 * in practice, so one prop drives both rather than adding a second that would
 * only ever mirror it.
 */
const props = defineProps({
  showHistory: { type: Boolean, default: true },
});
const emit = defineEmits(['open-recipes', 'open-bean', 'open-grinder', 'open-profile', 'open-roast', 'edit-profile']);

const { t } = useI18n();

const ICONS = {
  thermo: '<path d="M10 4a2 2 0 0 1 4 0v9a4.5 4.5 0 1 1-4 0V4z"/><path d="M12 9v6"/>',
  bean: '<path d="M7 7c3-4 9-3 10 1s-3 10-8 9-5-6-2-10z"/><path d="M9 8c2 2 4 3 6 7"/>',
  cup: '<path d="M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"/><path d="M16 9h1.5a2 2 0 0 1 0 4H16"/>',
  // Gear = grind-size adjustment. Feather-style cog: a toothed ring around a hub.
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  profile: '<path d="M4 19h16"/><path d="M4 16c3 0 3-9 6-9s3 6 5 6 3-2 5-2"/>',
  star: '<path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z"/>',
  drop: '<path d="M12 3.5s5.5 6.3 5.5 10a5.5 5.5 0 0 1-11 0c0-3.7 5.5-10 5.5-10z"/><path d="M9.5 14.5a2.8 2.8 0 0 0 2.3 2.7"/>',
};

// The combined identity title — shared with the Diary's recipe rows so the two
// render the same recipe identically (see useCore's recipeIdentityParts).
const titleParts = computed(() => recipeIdentityParts(recipe));

const roastLabel = computed(() =>
  recipe.roastDate ? `${t('espresso.roasted')} ${formatShortDate(recipe.roastDate)} · ${roastAge.value}` : t('espresso.setRoastDate')
);

async function editDose() {
  const v = await openNumberPad({ title: t('espresso.dose'), unit: 'g', value: recipe.targetDoseWeight.toFixed(1) });
  if (v == null) return;
  recipe.targetDoseWeight = parseFloat(v);
  await pushRecipe();
}
async function editGrind() {
  const v = await openNumberPad({ title: t('espresso.grindSize'), value: recipe.grinderSetting });
  if (v == null) return;
  recipe.grinderSetting = v;
  await pushRecipe();
}
// The yield editor also shows the brew ratio (1:x) as a second, linked field
// in the SAME modal — dose stays fixed, so editing either the yield grams or
// the ratio's "x" keeps the other in sync live (see NumberPad.vue's `linked`
// support). No standalone ratio display on the recipe page itself — this is
// the only place it's surfaced, only while actually editing yield.
async function editYield() {
  const dose = recipe.targetDoseWeight;
  const v = await openNumberPad({
    title: t('espresso.targetYield'), unit: 'g', value: recipe.targetYield.toFixed(1),
    linked: dose > 0 ? {
      label: t('espresso.ratio'), unit: '', prefix: '1 : ',
      value: (recipe.targetYield / dose).toFixed(1),
      toLinked: (yieldValue) => (yieldValue / dose).toFixed(1),
      toPrimary: (ratioValue) => (Math.round(dose * ratioValue * 10) / 10).toFixed(1),
    } : null,
  });
  if (v == null) return;
  recipe.targetYield = parseFloat(v);
  await pushRecipe();
}
async function editTemp() {
  const v = await openNumberPad({ title: t('espresso.stopAtTemp'), unit: '°C', value: String(recipe.groupTemp) });
  if (v == null) return;
  recipe.groupTemp = parseFloat(v);
  await pushRecipe();
}

/**
 * Press-and-pull-to-adjust for the recipe dials (see useDragDial.js). Unlike
 * the machine-function domains (steam/hotwater), pushRecipe() has no internal
 * debounce — it's a full gateway round-trip PLUS ensureRecipeBatch() every
 * call — so it must NOT run on every pointermove pixel. useDragDial's
 * onCommit fires exactly once, on release, rather than on a trailing debounce:
 * a debounce still fires mid-drag if the finger pauses even briefly, which is
 * exactly the "pushed before I lifted my finger" bug this replaced.
 */
// Every dial uses the same feel: DIAL_PX_PER_STEP px of drag = one step (see
// useDragDial). pxPerUnit = DIAL_PX_PER_STEP / step converts that to px-per-unit.
const doseDrag = useDragDial({
  get: () => recipe.targetDoseWeight,
  set: (v) => { recipe.targetDoseWeight = v; },
  onCommit: () => pushRecipe(),
  min: 5, max: 30, step: 0.1, pxPerUnit: DIAL_PX_PER_STEP / 0.1,
});
const onDoseClick = doseDrag.guardClick(editDose);

// Grind step comes from the selected recipe's grinder (its "small step" in the
// grinder editor) so one drag tick matches that grinder's finest real adjustment
// — falling back to 1 when no grinder is set, it's not found, or it has no small
// step configured.
const grindStep = computed(() => {
  const g = grinders.value.find((x) => x.id === recipe.grinderId);
  const s = Number(g?.settingSmallStep);
  return Number.isFinite(s) && s > 0 ? s : 1;
});
// Grind: same feel, but the step is the grinder's own small step (a 0.1-step
// Niche needs the same finger travel per click as a 1-step grinder).
const grindDrag = useDragDial({
  get: () => parseFloat(recipe.grinderSetting) || 0,
  set: (v) => { recipe.grinderSetting = String(Math.round(v * 100) / 100); },
  onCommit: () => pushRecipe(),
  min: 0, max: 100,
  step: () => grindStep.value,
  pxPerUnit: () => DIAL_PX_PER_STEP / grindStep.value,
});
const onGrindClick = grindDrag.guardClick(editGrind);

const yieldDrag = useDragDial({
  get: () => recipe.targetYield,
  set: (v) => { recipe.targetYield = v; },
  onCommit: () => pushRecipe(),
  min: 10, max: 70, step: 0.1, pxPerUnit: DIAL_PX_PER_STEP / 0.1,
});
const onYieldClick = yieldDrag.guardClick(editYield);

const tempDrag = useDragDial({
  get: () => recipe.groupTemp,
  set: (v) => { recipe.groupTemp = v; },
  onCommit: () => pushRecipe(),
  min: 80, max: 100, step: 1, pxPerUnit: DIAL_PX_PER_STEP / 1,
});
const onTempClick = tempDrag.guardClick(editTemp);

async function toggleStopAtWeight() {
  recipe.stopAtWeight = !recipe.stopAtWeight;
  await pushRecipe();
}

async function openRateRecipe() {
  const v = await openRating({ title: t('rating.title'), value: recipe.rating });
  if (v !== null) await setRecipeRating(v);
}
</script>

<template>
  <!-- Title + orbs, centred as a single group rather than each sized against
       whatever vertical space happens to be left over (see .espresso-body in
       app.css for why that mattered). The bottom button row used to sit in
       here too — see its own note below for why it doesn't any more. -->
  <div class="espresso-body">
    <!-- Classic page: the recipe's whole identity in one line. Tapping it
         opens the recipe browser, where this same title splits into three
         tappable bubbles at the same spot — that's how bean/grinder/profile
         are swapped individually (see RecipeOverlay.vue). -->
    <button v-if="showHistory" class="recipe-title" :aria-label="t('espresso.openRecipes')" @click="emit('open-recipes')">
      <template v-for="(part, i) in titleParts" :key="i">
        <span v-if="i > 0" class="dot">•</span>{{ part }}
      </template>
      <span class="chev">▾</span>
    </button>
    <!-- Edit Recipe overlay: already-split bubbles in the same spot, so each
         of bean/grinder/profile can be picked directly. -->
    <RecipeIdentityBubbles
      v-else
      tall
      @pick-bean="emit('open-bean')"
      @pick-grinder="emit('open-grinder')"
      @pick-profile="emit('open-profile')"
    />

    <div class="dials">
      <div class="dial-group">
        <!-- Orbs are labelled by what they ADJUST, not by which identity they
             belong to — that's already spelled out in the title above. -->
        <span class="dial-label">{{ t('espresso.dose') }}</span>
        <button
          class="dial"
          :class="{ dragging: doseDrag.dragging.value }"
          @click="onDoseClick"
          @pointerdown="doseDrag.onPointerDown"
          @pointermove="doseDrag.onPointerMove"
          @pointerup="doseDrag.onPointerUp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.bean"></svg>
          <span class="num">{{ recipe.targetDoseWeight.toFixed(1) }}</span><span class="unit">g</span>
        </button>
        <!-- Roast-date chip: describes the bag, so it sits under the bean's
             own orb rather than as a page-wide header. -->
        <button class="roast-chip" @click="emit('open-roast')">
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.drop"></svg>{{ roastLabel }}
        </button>
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('espresso.grindSize') }}</span>
        <button
          class="dial"
          :class="{ dragging: grindDrag.dragging.value }"
          @click="onGrindClick"
          @pointerdown="grindDrag.onPointerDown"
          @pointermove="grindDrag.onPointerMove"
          @pointerup="grindDrag.onPointerUp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.gear"></svg>
          <span class="num">{{ recipe.grinderSetting }}</span>
          <!-- Grind size is unitless, but an empty unit line keeps the icon/num/
               unit stack the same height as the dose orb (which has "g"), so both
               numbers centre at the same vertical position. -->
          <span class="unit" aria-hidden="true">&nbsp;</span>
        </button>
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('espresso.stopAtTemp') }}</span>
        <div class="dial dial-duo">
          <div class="duo">
            <button
              :class="{ dragging: yieldDrag.dragging.value, faded: !recipe.stopAtWeight }"
              @click="onYieldClick"
              @pointerdown="yieldDrag.onPointerDown"
              @pointermove="yieldDrag.onPointerMove"
              @pointerup="yieldDrag.onPointerUp"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.cup"></svg><br />
              <span class="num">{{ recipe.targetYield.toFixed(1) }}</span><br /><span class="unit">g</span>
            </button>
            <button
              :class="{ dragging: tempDrag.dragging.value }"
              @click="onTempClick"
              @pointerdown="tempDrag.onPointerDown"
              @pointermove="tempDrag.onPointerMove"
              @pointerup="tempDrag.onPointerUp"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.thermo"></svg><br />
              <span class="num">{{ recipe.groupTemp }}</span><br /><span class="unit">°C</span>
            </button>
          </div>
          <!-- Stop-at-weight toggle, text-free: the dimmed yield grams are the
               only "off" cue now (see .faded above). -->
          <button
            class="switch stop-toggle"
            :class="{ on: recipe.stopAtWeight }"
            role="switch"
            :aria-checked="recipe.stopAtWeight"
            :aria-label="t('espresso.stopAtWeight')"
            @click="toggleStopAtWeight"
          ></button>
        </div>
      </div>
    </div>

  </div>

  <!-- OUTSIDE .espresso-body on purpose: as a direct child of the parent flex
       column it pins to the bottom exactly like Cleaning's and Steam's rows,
       because .espresso-body absorbs the leftover height the way .dials does
       on those pages. Inside the centred group it rode up with the orbs, so
       the one row that is meant to be identical across every tab was the one
       that moved when you switched tabs (and the gap under it grew with the
       screen). No Browse-recipes button: the identity title above is the way
       into the library now, so Edit profile takes the leftmost slot. -->
  <div class="prep-bottom prep-bottom-3">
    <button v-if="recipe.selectedProfileId" class="btn" @click="emit('edit-profile')">
      <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.profile"></svg>{{ t('espresso.editProfile') }}
    </button>
    <!-- Once rated, the earned stars take this slot over from the "Rate"
         label — tapping them reopens the same editor, so the rating is both
         the display and the control. StarRating renders no nested <button>
         in readonly mode, so the tap reaches this one. -->
    <button class="rate-recipe-btn" :aria-label="t('rating.rate')" @click="openRateRecipe">
      <StarRating v-if="recipe.rating > 0" :model-value="recipe.rating" readonly :size="18" />
      <template v-else>
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.star"></svg>{{ t('rating.rate') }}
      </template>
    </button>
    <!-- Hidden inside the Edit Recipe overlay (RecipeBrowser's graph mode) —
         the on-page graph there IS the history, so this door isn't offered
         twice. -->
    <button v-if="showHistory" class="btn" @click="loadHistoryForCurrentRecipe">
      <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.history"></svg>{{ t('espresso.history') }}
    </button>
  </div>
</template>
