<script setup>
/**
 * The "new recipe" wizard: choose/add a bean, choose a profile, compose and
 * persist, then ask for the roast date if the bag hasn't got one. Two callers,
 * same steps — the Diary's "+" and the Espresso page's empty state.
 *
 * Browsing the existing library is NOT this component's job: that's
 * RecipeOverlay (quick switch, from the Coffee page's title) and the Diary's
 * Recipes view (organise/manage). This used to carry a third "list" mode for
 * it, which both of those replaced.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { recipe, composeNewRecipe, createRecipeFromCurrent, setRoastDate } from '../composables/useRecipe.js';
import { grinders, singleGrinder, formatGrinderLabel } from '../composables/useCore.js';
import { openChooser } from '../composables/useModals.js';
import BeanChooser from './BeanChooser.vue';
import ProfilePicker from './ProfilePicker.vue';
import RecipeCrumbs from './RecipeCrumbs.vue';
import RoastDatePicker from './RoastDatePicker.vue';

const emit = defineEmits(['back', 'created']);
const { t } = useI18n();

/**
 * Where the caller already was. The Diary opens this from inside a roaster —
 * or from inside a bean, in which case the bean step has nothing left to ask
 * and the wizard starts at the profile.
 */
const props = defineProps({
  presetBean: { type: Object, default: null },
  presetRoaster: { type: String, default: '' },
});

const step = ref(props.presetBean ? 'profile' : 'bean'); // 'bean' | 'profile' | 'roast'
const chosenBean = ref(props.presetBean);
const chosenGrinder = ref(null);
const createdRecipe = ref(null);

/**
 * The grinder is asked for BETWEEN the two screens, not after the profile as it
 * used to be. With the crumbs showing Bean · Grinder · Profile, a question that
 * arrives after the last bubble is filled would contradict the trail the user
 * is reading. With one grinder configured there is nothing to ask.
 */
async function onBeanPicked(bean) {
  chosenBean.value = bean;

  if (!singleGrinder.value) {
    const grinderId = await openChooser({
      title: t('recipePicker.chooseGrinder'),
      options: grinders.value.map((g) => [g.id, formatGrinderLabel(g)]),
      current: recipe.grinderId,
    });
    // Cancelled: back to the bean step. Skipped INTO the profile step with a
    // preset bean, that is also the way out — the grinder question would
    // otherwise be unanswerable and the recipe unfinishable.
    if (grinderId == null) { step.value = 'bean'; return; }
    chosenGrinder.value = grinders.value.find((g) => g.id === grinderId) ?? null;
  }

  step.value = 'profile';
}

// A preset bean still owes the grinder question, so it runs the same path
// rather than jumping past it.
onMounted(() => { if (props.presetBean) onBeanPicked(props.presetBean); });

/**
 * The recipe is real from here on — the roast step below runs on a SAVED recipe,
 * so skipping it still leaves you with the thing you came to make.
 */
async function onProfilePicked(profile) {
  const g = chosenGrinder.value;
  const seedContext = g ? { grinderId: g.id, grinderModel: g.model || '—' } : null;
  const inheritedRoastDate = await composeNewRecipe({ bean: chosenBean.value, profile, seedContext });
  createdRecipe.value = await createRecipeFromCurrent();

  // Only ask when there is nothing to inherit. composeNewRecipe joins the bean's
  // current bag when it has a dated one, so a second recipe on a bag you already
  // dated goes straight through — asking again would invite a stray new bag
  // dated today, since that is what the picker opens on.
  // Its RETURN value, not recipe.roastDate: see the note where it returns.
  if (!inheritedRoastDate) { step.value = 'roast'; return; }
  finish();
}

function finish() {
  emit('created', createdRecipe.value);
  emit('back');
}

/**
 * setRoastDate does the bag work: it re-resolves onto the bag for THIS date and
 * GCs the one the recipe was just created on (brand new, so it has no shots to
 * strand). One bag out, not two.
 */
async function onRoastPicked(iso) {
  await setRoastDate(iso);
  finish();
}
</script>

<template>
  <BeanChooser v-if="step === 'bean'" :preset-roaster="presetRoaster" @pick="onBeanPicked" @back="emit('back')">
    <template #crumbs>
      <RecipeCrumbs :bean="chosenBean" :grinder="chosenGrinder" />
    </template>
  </BeanChooser>
  <ProfilePicker
    v-else
    mode="pick"
    :current-title="recipe.profileTitle"
    :confirm-label="t('recipePicker.createRecipe')"
    @select="onProfilePicked"
    @back="step = 'bean'"
  >
    <!-- The picker hands over whatever is highlighted, so the last bubble
         fills while browsing rather than at the moment of no return. -->
    <template #crumbs="{ selected }">
      <RecipeCrumbs :bean="chosenBean" :grinder="chosenGrinder" :profile="selected" />
    </template>
  </ProfilePicker>

  <!-- Last, and only when the bag has no date yet: the recipe already exists, so
       cancelling is a real skip rather than a way to lose the work. It stays on
       the undated bag and the Coffee page's roast chip can still set it later —
       which was the ONLY way to set one before this step existed, and the reason
       so many recipes never got a date at all. -->
  <RoastDatePicker
    v-if="step === 'roast'"
    :model-value="recipe.roastDate"
    @confirm="onRoastPicked"
    @cancel="finish"
  />
</template>
