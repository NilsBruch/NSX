<script setup>
/**
 * The graph layout's compact stand-in for RecipeBody.vue's big circular dials
 * (skinSettings.coffeeGraph — see RecipeBrowser.vue): the same four values
 * (dose/grind/output/temp), same tap-to-edit and drag-to-nudge behaviour
 * (useRecipeDials.js — shared with RecipeBody so that wiring exists in
 * exactly one place), just laid out as one full-width card instead of three
 * big orbs, so there's still room for the shot graph above it. The component
 * renders TWO rows: the card of four values, and a thinner, card-less row
 * below it for the roast-date chip and the auto-stop toggle (the latter
 * aligned to the target-yield column it governs).
 *
 * Deliberately NOT included here: bean/grinder/profile swapping. In this
 * layout the recipe card list is already the way you switch between
 * bean+profile combinations, so a card's long-press menu (RecipeBrowser.vue)
 * covers that instead of a second, on-page control.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatShortDate } from '../composables/useCore.js';
import { recipe, roastAge } from '../composables/useRecipe.js';
import { useRecipeDials } from '../composables/useRecipeDials.js';
import { dispTemp, tempUnitLabel } from '../composables/useUnits.js';

const emit = defineEmits(['open-roast']);
const { t } = useI18n();
const { NSXCore } = window;
const {
  onDoseClick, doseDrag, onGrindClick, grindDrag, onYieldClick, yieldDrag,
  onTempClick, tempDrag, toggleStopAtWeight,
} = useRecipeDials();

// Brew ratio, shown next to the yield it's derived from. calcRatio already
// returns the full "1:x.x" string (and "—" for a dose of 0), so nothing here
// needs to re-derive or format it.
const ratio = computed(() => NSXCore.calcRatio(recipe.targetDoseWeight, recipe.targetYield));

// Same label as RecipeBody's roast chip (see its own copy of this computed).
const roastLabel = computed(() =>
  recipe.roastDate ? `${t('espresso.roasted')} ${formatShortDate(recipe.roastDate)} · ${roastAge.value}` : t('espresso.setRoastDate')
);

const ICONS = {
  thermo: '<path d="M10 4a2 2 0 0 1 4 0v9a4.5 4.5 0 1 1-4 0V4z"/><path d="M12 9v6"/>',
  bean: '<path d="M7 7c3-4 9-3 10 1s-3 10-8 9-5-6-2-10z"/><path d="M9 8c2 2 4 3 6 7"/>',
  cup: '<path d="M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"/><path d="M16 9h1.5a2 2 0 0 1 0 4H16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  drop: '<path d="M12 3.5s5.5 6.3 5.5 10a5.5 5.5 0 0 1-11 0c0-3.7 5.5-10 5.5-10z"/><path d="M9.5 14.5a2.8 2.8 0 0 0 2.3 2.7"/>',
};
</script>

<template>
  <div class="recipe-quick">
    <div class="rq-values">
      <button
        class="rq-item"
        :class="{ dragging: doseDrag.dragging.value }"
        @click="onDoseClick"
        @pointerdown="doseDrag.onPointerDown"
        @pointermove="doseDrag.onPointerMove"
        @pointerup="doseDrag.onPointerUp"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.bean"></svg>
        <span class="rq-num">{{ recipe.targetDoseWeight.toFixed(1) }}<span class="rq-unit">g</span></span>
        <span class="rq-label">{{ t('espresso.dose') }}</span>
      </button>

      <button
        class="rq-item"
        :class="{ dragging: grindDrag.dragging.value }"
        @click="onGrindClick"
        @pointerdown="grindDrag.onPointerDown"
        @pointermove="grindDrag.onPointerMove"
        @pointerup="grindDrag.onPointerUp"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.gear"></svg>
        <span class="rq-num">{{ recipe.grinderSetting }}</span>
        <span class="rq-label">{{ t('espresso.grindSize') }}</span>
      </button>

      <button
        class="rq-item"
        :class="{ dragging: yieldDrag.dragging.value, faded: !recipe.stopAtWeight }"
        @click="onYieldClick"
        @pointerdown="yieldDrag.onPointerDown"
        @pointermove="yieldDrag.onPointerMove"
        @pointerup="yieldDrag.onPointerUp"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.cup"></svg>
        <span class="rq-num">{{ recipe.targetYield.toFixed(1) }}<span class="rq-unit">g</span><span class="rq-ratio">({{ ratio }})</span></span>
        <span class="rq-label">{{ t('espresso.targetYield') }}</span>
      </button>

      <button
        class="rq-item"
        :class="{ dragging: tempDrag.dragging.value }"
        @click="onTempClick"
        @pointerdown="tempDrag.onPointerDown"
        @pointermove="tempDrag.onPointerMove"
        @pointerup="tempDrag.onPointerUp"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.thermo"></svg>
        <span class="rq-num">{{ dispTemp(recipe.groupTemp) }}<span class="rq-unit">{{ tempUnitLabel }}</span></span>
        <span class="rq-label">{{ t('espresso.temp') }}</span>
      </button>
    </div>

  </div>

  <!-- Roast chip + auto-stop toggle, on their OWN row below the card rather
       than inside it: the card is the four dialled values, these two are the
       context around them (which bag, and whether the yield auto-stops). The
       row keeps the card's 4 columns and side padding, so the toggle still
       lines up under the target yield it governs — the dimmed yield
       (.rq-item.faded) is the only other cue it's off. -->
  <div class="rq-extras">
    <button class="roast-chip" @click="emit('open-roast')">
      <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.drop"></svg>{{ roastLabel }}
    </button>
    <button
      class="switch sm"
      :class="{ on: recipe.stopAtWeight }"
      role="switch"
      :aria-checked="recipe.stopAtWeight"
      :aria-label="t('espresso.stopAtWeight')"
      @click="toggleStopAtWeight"
    ></button>
  </div>
</template>
