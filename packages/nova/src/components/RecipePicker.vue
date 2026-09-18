<script setup>
/**
 * The "new recipe" wizard: choose/add a bean, choose a bag (batch), choose a
 * grinder, choose a profile, compose and persist. Two callers, same steps —
 * the Diary's "+" and the Espresso page's empty state.
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
import BatchPicker from './BatchPicker.vue';
import ProfilePicker from './ProfilePicker.vue';
import RecipeCrumbs from './RecipeCrumbs.vue';

const emit = defineEmits(['back', 'created']);
const { t } = useI18n();

/**
 * Where the caller already was. The Diary opens this from inside a roaster —
 * or from inside a bean, in which case the bean step has nothing left to ask
 * and the wizard starts at the bag step.
 */
const props = defineProps({
  presetBean: { type: Object, default: null },
  presetRoaster: { type: String, default: '' },
});

const step = ref(props.presetBean ? 'batch' : 'bean'); // 'bean' | 'batch' | 'profile'
const chosenBean = ref(props.presetBean);
const chosenBatch = ref(null); // { id, roastDate } | null
const chosenGrinder = ref(null);
const createdRecipe = ref(null);

function onBeanPicked(bean) {
  chosenBean.value = bean;
  step.value = 'batch';
}

/**
 * The grinder is asked for AFTER the bag, not after the profile as it used to
 * be. With the crumbs showing Bean · Grinder · Profile, a question that
 * arrives after the last bubble is filled would contradict the trail the user
 * is reading. With one grinder configured there is nothing to ask.
 */
async function onBatchPicked(batch) {
  chosenBatch.value = batch;

  if (!singleGrinder.value) {
    const grinderId = await openChooser({
      title: t('recipePicker.chooseGrinder'),
      options: grinders.value.map((g) => [g.id, formatGrinderLabel(g)]),
      current: recipe.grinderId,
    });
    // Cancelled: back to the bean step. Skipped INTO the bag step with a
    // preset bean, that is also the way out — the grinder question would
    // otherwise be unanswerable and the recipe unfinishable.
    if (grinderId == null) { step.value = 'bean'; return; }
    chosenGrinder.value = grinders.value.find((g) => g.id === grinderId) ?? null;
  }

  step.value = 'profile';
}

async function onProfilePicked(profile) {
  const g = chosenGrinder.value;
  const seedContext = g ? { grinderId: g.id, grinderModel: g.model || '—' } : null;
  await composeNewRecipe({ bean: chosenBean.value, profile, seedContext, batch: chosenBatch.value });
  createdRecipe.value = await createRecipeFromCurrent();
  finish();
}

function finish() {
  emit('created', createdRecipe.value);
  emit('back');
}
</script>

<template>
  <!-- One steady outer element for the whole wizard. Where it is opened, the
       wizard slides in and out as a page (<PageTransition>), and Vue
       hands that transition to the component's ROOT; with the three steps
       themselves as the root, every step change would have run it too — the
       step being left sliding off to the right while the next slid in over
       it. Inside this, stepping is an instant swap. Fixed and full-screen
       (.page-host) because the steps are fixed overlays: while the host
       moves, they are positioned against it, so it has to be the screen. -->
  <div class="page-host">
    <BeanChooser v-if="step === 'bean'" :preset-roaster="presetRoaster" @pick="onBeanPicked" @back="emit('back')">
      <template #crumbs>
        <RecipeCrumbs :bean="chosenBean" :batch="chosenBatch" :grinder="chosenGrinder" />
      </template>
    </BeanChooser>
    <BatchPicker
      v-else-if="step === 'batch'"
      :bean="chosenBean"
      @pick="onBatchPicked"
      @back="step = 'bean'"
    >
      <template #crumbs>
        <RecipeCrumbs :bean="chosenBean" :batch="chosenBatch" :grinder="chosenGrinder" />
      </template>
    </BatchPicker>
    <ProfilePicker
      v-else
      mode="pick"
      :current-title="recipe.profileTitle"
      :confirm-label="t('recipePicker.createRecipe')"
      @select="onProfilePicked"
      @back="step = 'batch'"
    >
      <!-- The picker hands over whatever is highlighted, so the last bubble
           fills while browsing rather than at the moment of no return. -->
      <template #crumbs="{ selected }">
        <RecipeCrumbs :bean="chosenBean" :batch="chosenBatch" :grinder="chosenGrinder" :profile="selected" />
      </template>
    </ProfilePicker>
  </div>
</template>
