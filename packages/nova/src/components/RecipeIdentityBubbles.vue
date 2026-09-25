<script setup>
/**
 * The three tappable Bean / Grinder / Profile bubbles — lifted out of
 * RecipeOverlay.vue (where they sit under the page title) so a second
 * consumer could show the SAME bubbles without a second copy of this markup
 * to drift out of sync with it.
 */
import { useI18n } from 'vue-i18n';
import { recipe, grinderUnset } from '../composables/useRecipe.js';
import { singleGrinder, recipeRoasterName, recipeCoffeeName, recipeProfileTitle } from '../composables/useCore.js';

const emit = defineEmits(['pickBean', 'pickGrinder', 'pickProfile']);
const { t } = useI18n();
</script>

<template>
  <div class="rov-identity">
    <button class="rov-bubble" @click="emit('pickBean')">
      <span class="rov-bubble-label">{{ t('espresso.bean') }}</span>
      <span class="rov-bubble-name">{{ recipeRoasterName(recipe) }} {{ recipeCoffeeName(recipe) }}</span>
    </button>
    <!-- Nothing to switch TO with a single grinder (see useCore's
         singleGrinder) — plain, not a button. Unless the recipe has no
         grinder at all: then there IS something to set. -->
    <button v-if="!singleGrinder || grinderUnset" class="rov-bubble" @click="emit('pickGrinder')">
      <span class="rov-bubble-label">{{ t('espresso.grinder') }}</span>
      <span class="rov-bubble-name">{{ grinderUnset ? '—' : recipe.grinderModel }}</span>
    </button>
    <div v-else class="rov-bubble plain">
      <span class="rov-bubble-label">{{ t('espresso.grinder') }}</span>
      <span class="rov-bubble-name">{{ recipe.grinderModel }}</span>
    </div>
    <button class="rov-bubble" @click="emit('pickProfile')">
      <span class="rov-bubble-label">{{ t('espresso.profile') }}</span>
      <span class="rov-bubble-name">{{ recipeProfileTitle(recipe) }}</span>
    </button>
  </div>
</template>
