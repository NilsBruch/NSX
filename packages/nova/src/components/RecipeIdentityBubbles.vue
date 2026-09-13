<script setup>
/**
 * The three tappable Bean / Grinder / Profile bubbles — lifted out of
 * RecipeOverlay.vue (where they sit under the page title) so
 * EspressoView.vue's Edit Recipe overlay can show the SAME bubbles in its
 * own header row (replacing the "Edit recipe" title text) without a second
 * copy of this markup to drift out of sync with it.
 */
import { useI18n } from 'vue-i18n';
import { recipe, grinderUnset } from '../composables/useRecipe.js';
import { singleGrinder } from '../composables/useCore.js';

const props = defineProps({
  // RecipeOverlay.vue's identity row sits at .recipe-title's own 54px height
  // (see its own comment on why that matters there) and RecipeCrumbs.vue's
  // wizard trail is deliberately compact too — both keep the default,
  // single-line-per-bubble layout. The Edit Recipe overlay has no such
  // height to match and was clipping long names, so it opts into `tall`:
  // taller bubbles, the bean split across two deliberate rows (roaster, then
  // name — each truncating on its own rather than sharing one line), and
  // grinder/profile allowed to wrap generically onto a second line.
  tall: { type: Boolean, default: false },
});
const emit = defineEmits(['pickBean', 'pickGrinder', 'pickProfile']);
const { t } = useI18n();
</script>

<template>
  <div class="rov-identity" :class="{ tall }">
    <button class="rov-bubble" @click="emit('pickBean')">
      <span class="rov-bubble-label">{{ t('espresso.bean') }}</span>
      <span v-if="!tall" class="rov-bubble-name">{{ recipe.coffeeRoaster }} {{ recipe.coffeeName }}</span>
      <template v-else>
        <span class="rov-bubble-name">{{ recipe.coffeeRoaster }}</span>
        <span class="rov-bubble-name">{{ recipe.coffeeName }}</span>
      </template>
    </button>
    <!-- Nothing to switch TO with a single grinder (see useCore's
         singleGrinder) — plain, not a button. Unless the recipe has no
         grinder at all: then there IS something to set. -->
    <button v-if="!singleGrinder || grinderUnset" class="rov-bubble" @click="emit('pickGrinder')">
      <span class="rov-bubble-label">{{ t('espresso.grinder') }}</span>
      <span class="rov-bubble-name rov-bubble-wrap">{{ grinderUnset ? '—' : recipe.grinderModel }}</span>
    </button>
    <div v-else class="rov-bubble plain">
      <span class="rov-bubble-label">{{ t('espresso.grinder') }}</span>
      <span class="rov-bubble-name rov-bubble-wrap">{{ recipe.grinderModel }}</span>
    </div>
    <button class="rov-bubble" @click="emit('pickProfile')">
      <span class="rov-bubble-label">{{ t('espresso.profile') }}</span>
      <span class="rov-bubble-name rov-bubble-wrap">{{ recipe.profileTitle }}</span>
    </button>
  </div>
</template>
