<script setup>
/**
 * The "new recipe" wizard: choose/add a bean, then choose a profile, then
 * compose and persist. Two callers, same two steps — the Diary's "+" and the
 * Espresso page's empty state.
 *
 * Browsing the existing library is NOT this component's job: that's
 * RecipeOverlay (quick switch, from the Coffee page's title) and the Diary's
 * Recipes view (organise/manage). This used to carry a third "list" mode for
 * it, which both of those replaced.
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { recipe, composeNewRecipe, createRecipeFromCurrent } from '../composables/useRecipe.js';
import { grinders, singleGrinder, formatGrinderLabel } from '../composables/useCore.js';
import { openChooser } from '../composables/useModals.js';
import BeanChooser from './BeanChooser.vue';
import ProfilePicker from './ProfilePicker.vue';

const emit = defineEmits(['back', 'created']);
const { t } = useI18n();

const step = ref('bean'); // 'bean' | 'profile'
const chosenBean = ref(null);

function onBeanPicked(bean) {
  chosenBean.value = bean;
  step.value = 'profile';
}

async function onProfilePicked(profile) {
  // With more than one grinder connected, a new recipe can't silently default
  // to "whichever grinder loaded first" — the user has to pick which one this
  // bean is actually ground on. A single grinder needs no such prompt.
  let seedContext = null;
  if (!singleGrinder.value) {
    const grinderId = await openChooser({
      title: t('recipePicker.chooseGrinder'),
      options: grinders.value.map((g) => [g.id, formatGrinderLabel(g)]),
      current: recipe.grinderId,
    });
    if (grinderId == null) return; // cancelled — stay on the profile step, no recipe created
    const grinder = grinders.value.find((g) => g.id === grinderId);
    seedContext = { grinderId: grinder.id, grinderModel: grinder.model || '—' };
  }
  await composeNewRecipe({ bean: chosenBean.value, profile, seedContext });
  const created = await createRecipeFromCurrent();
  emit('created', created);
  emit('back');
}
</script>

<template>
  <BeanChooser v-if="step === 'bean'" @pick="onBeanPicked" @back="emit('back')" />
  <ProfilePicker
    v-else
    mode="pick"
    :current-title="recipe.profileTitle"
    @select="onProfilePicked"
    @back="step = 'bean'"
  />
</template>
