<script setup>
/**
 * The "new recipe" wizard: choose/add a bean, choose a bag (batch) — only when
 * the bean has none open — choose a grinder, choose a profile, compose and
 * persist. Callers: the Diary's "+ New recipe" / "+ New bag" (`mode`) and the
 * Espresso page's empty state. "+ New bag" stops after the roast date: it
 * hands the new bag back (`bag-opened`) and the Diary opens it, where its
 * coffee's recipes are listed and "+ New recipe" starts from that bag.
 *
 * Browsing the existing library is NOT this component's job: that's
 * RecipeOverlay (quick switch, from the Coffee page's title) and the Diary's
 * Recipes view (organise/manage). This used to carry a third "list" mode for
 * it, which both of those replaced.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { recipe, composeNewRecipe, createRecipeFromCurrent } from '../composables/useRecipe.js';
import { grinders, singleGrinder, formatGrinderLabel } from '../composables/useCore.js';
import { openChooser } from '../composables/useModals.js';
import { offerFinishOtherBags } from '../composables/useBeanActions.js';
import BeanChooser from './BeanChooser.vue';
import BatchPicker from './BatchPicker.vue';
import RoastDatePicker from './RoastDatePicker.vue';
import ProfilePicker from './ProfilePicker.vue';
import RecipeCrumbs from './RecipeCrumbs.vue';

const emit = defineEmits(['back', 'created', 'bag-opened']);
const { t } = useI18n();

/**
 * Where the caller already was. The Diary opens this from inside a roaster —
 * or from inside a bean, in which case the bean step has nothing left to ask
 * and the wizard starts at the bag step.
 */
const props = defineProps({
  presetBean: { type: Object, default: null },
  presetRoaster: { type: String, default: '' },
  /** The bag the new recipe brews from (an open bag the Diary has opened):
   *  with it, the bag step is answered too and the wizard starts at the
   *  grinder/profile. Only alongside presetBean. */
  presetBatch: { type: Object, default: null },
  /**
   * 'recipe' — a new recipe on a coffee (trying another profile). The bag is
   *            the bean's open one; only a bean with none asks for a bag.
   * 'bag'    — a new bag: coffee -> roast date, then `bag-opened` with
   *            { bean, batch } and close. Ignores the presets: it always
   *            starts at the coffee.
   */
  mode: { type: String, default: 'recipe' },
});
const { NSXCore, NSXApi } = window;
const bagMode = props.mode === 'bag';

const fromBag = !bagMode && !!props.presetBean && !!props.presetBatch;
const step = ref(fromBag ? 'profile' : props.presetBean && !bagMode ? 'batch' : 'bean'); // 'bean' | 'batch' | 'profile'
const chosenBean = ref(bagMode ? null : props.presetBean);
const chosenBatch = ref(null); // { id, roastDate } | null
const chosenGrinder = ref(null);
const createdRecipe = ref(null);
const showRoastPicker = ref(false);
// Where the profile step's Back goes: the bag step only if it was shown.
const profileBack = ref('batch');

// Started from a bag: only the grinder can still need asking (onBatchPicked).
onMounted(() => {
  if (!fromBag) return;
  profileBack.value = 'bean';
  onBatchPicked({ id: props.presetBatch.id, roastDate: props.presetBatch.roastDate ?? null });
});

async function onBeanPicked(bean) {
  chosenBean.value = bean;
  if (bagMode) { showRoastPicker.value = true; return; }
  // A recipe brews from its bean's open bag (core's resolveBrewBatch), so
  // asking which bag is only a question when the bean has none open.
  try {
    const res = await NSXApi.fetchBatches(bean.id, false);
    if ((Array.isArray(res) ? res : (res?.items ?? [])).length) {
      const open = await NSXCore.resolveBrewBatch(bean.id);
      profileBack.value = 'bean';
      await onBatchPicked({ id: open.id, roastDate: open.roastDate ?? null });
      return;
    }
  } catch (err) {
    console.warn("[Nova] could not read this bean's bags", err?.message);
  }
  profileBack.value = 'batch';
  step.value = 'batch';
}

/**
 * Bag mode, roast date confirmed: open the bag, offer to finish the old one,
 * and hand the bag back. Which recipe to brew from it is chosen in the Diary's
 * view of that bag, not here — that view lists every recipe of the coffee and
 * has "+ New recipe" for another profile.
 */
async function onRoastConfirm(iso) {
  showRoastPicker.value = false;
  const bean = chosenBean.value;
  const batch = await NSXCore.resolveBatch(bean.id, iso);
  await offerFinishOtherBags(bean.id, batch?.id);
  emit('bag-opened', { bean, batch });
  emit('back');
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
      <!-- Not for a new bag: it ends at the roast date, so a trail promising
           grinder and profile steps would describe a wizard it isn't. Without
           the slot, the chooser shows its own "Choose bean" title. -->
      <template v-if="!bagMode" #crumbs>
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
    <!-- No current-title: that is the profile of the recipe LOADED on the
         machine, which has nothing to do with the one being created here. It
         seeded the picker's selection, so this step opened with an answer
         already filled in — and the confirm button here CREATES the recipe,
         so a pre-filled answer is one tap from a recipe nobody chose. -->
    <ProfilePicker
      v-else
      mode="pick"
      :confirm-label="t('recipePicker.createRecipe')"
      @select="onProfilePicked"
      @back="step = profileBack"
    >
      <!-- The picker hands over whatever is highlighted, so the last bubble
           fills while browsing rather than at the moment of no return. -->
      <template #crumbs="{ selected }">
        <RecipeCrumbs :bean="chosenBean" :batch="chosenBatch" :grinder="chosenGrinder" :profile="selected" />
      </template>
    </ProfilePicker>
    <RoastDatePicker v-if="showRoastPicker" @confirm="onRoastConfirm" @cancel="showRoastPicker = false" />
  </div>
</template>
