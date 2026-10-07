<script setup>
/**
 * One coffee's recipes, full screen, as the Coffee page's horizontal card
 * strip — most recently brewed first (leftmost), so carrying on with the last
 * one is one tap. Used by RecipePicker.vue's "+ New bag" flow ('recipe' step),
 * whose crumbs come in through the `crumbs` slot; without them the header
 * falls back to a plain title.
 * Recipes belong to the bean, not to a bag: loading one brews from the bean's
 * open bag (core's resolveBrewBatch). Picking is the caller's job (`pick`), as
 * is the bottom action (`other`: another profile / a new recipe).
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { shots } from '../composables/useCore.js';
import { recipesUsingBean } from '../composables/useRecipe.js';
import RecipeCard from './RecipeCard.vue';

const props = defineProps({
  bean: { type: Object, required: true },
  otherLabel: { type: String, required: true },
});
const emit = defineEmits(['pick', 'other', 'back']);
const { t } = useI18n();

const list = computed(() =>
  window.NSXCore.sortRecipesByLastUsed(recipesUsingBean(props.bean), shots.value)
);
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <slot name="crumbs"><span class="ov-title">{{ t('diary.recipesForCoffee') }} · {{ bean.name }}</span></slot>
      <!-- Reserves the width of the other wizard screens' trailing header
           button, so the crumbs sit where they do on every step (BatchPicker). -->
      <span class="sort-btn lg icon-only" aria-hidden="true" style="visibility: hidden">
        <svg viewBox="0 0 24 24"></svg>
      </span>
    </div>
    <span v-if="$slots.crumbs" class="list-label">{{ t('diary.recipeForBag') }}</span>
    <!-- reserve-kit for the same reason RecipeOverlay passes it: the strip
         stretches every card to the tallest. -->
    <div class="rp-strip bean-recipe-strip">
      <RecipeCard v-for="entry in list" :key="entry.id" :entry="entry" reserve-kit @click="emit('pick', entry)" />
      <div v-if="!list.length" class="rp-empty">{{ t('diary.noRecipesYet') }}</div>
    </div>
    <div class="prep-bottom">
      <button class="btn" @click="emit('other')">+ {{ otherLabel }}</button>
    </div>
  </div>
</template>
