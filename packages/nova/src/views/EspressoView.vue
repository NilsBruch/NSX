<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders, formatGrinderLabel } from '../composables/useCore.js';
import { recipe, pushRecipe, setRoastDate, setRecipeBean, setRecipeGrinder, cloneProfile, applyEditedProfile } from '../composables/useRecipe.js';
import { openChooser, openConfirm } from '../composables/useModals.js';
import { skinSettings } from '../composables/useSettings.js';
import RecipePicker from '../components/RecipePicker.vue';
import RecipeOverlay from '../components/RecipeOverlay.vue';
import RecipeBody from '../components/RecipeBody.vue';
import RecipeBrowser from '../components/RecipeBrowser.vue';
import ProfilePicker from '../components/ProfilePicker.vue';
import RoastDatePicker from '../components/RoastDatePicker.vue';
import BeanChooser from '../components/BeanChooser.vue';
import ProfileEditor from '../components/settings/ProfileEditor.vue';

const { t } = useI18n();
const { NSXCore } = window;

const ICONS = {
  bean: '<path d="M7 7c3-4 9-3 10 1s-3 10-8 9-5-6-2-10z"/><path d="M9 8c2 2 4 3 6 7"/>',
  profile: '<path d="M4 19h16"/><path d="M4 16c3 0 3-9 6-9s3 6 5 6 3-2 5-2"/>',
};

// Same "nothing loaded yet" signal the old title placeholder used (first
// launch, or adoptCurrentWorkflowAsRecipe finding no roaster/name at boot —
// see useRecipe.js). Both layouts below are meaningless without a bean+profile
// behind them, so they're replaced by an empty state rather than showing
// 0g/0°C and a roast-date chip with no bean to attach to.
const hasRecipe = computed(() => {
  const roaster = recipe.coffeeRoaster;
  const name = recipe.coffeeName;
  return !!(roaster && roaster !== '—' && name && name !== '—');
});

// The blurred recipe browser, opened by tapping the combined identity title
// (classic layout) or a recipe card's own bubbles (graph layout, via
// RecipeBrowser -> RecipeOverlay's own "+"/edit affordances stay local to it;
// this instance is reached only from RecipeBody's identity title).
const showRecipeOverlay = ref(false);
const showProfilePicker = ref(false);
const showRoastPicker = ref(false);
const showProfileEditor = ref(false);
const showBeanChooser = ref(false);
// The bean->profile creation wizard — the same entry point the Diary's "+" uses.
const showRecipeCreator = ref(false);
// Graph layout only: RecipeBody rendered as a full-screen "Edit Recipe" overlay
// instead of the page itself — see RecipeBrowser.vue's @edit.
const showRecipeEditor = ref(false);

// Toggling the setting can't strand the Edit Recipe overlay over the classic
// layout it no longer belongs to.
watch(() => skinSettings.coffeeGraph, () => { showRecipeEditor.value = false; });

// Bean and grinder tiles' own pickers — see useRecipe.js's setRecipeBean/
// setRecipeGrinder for why these swap in place (same recipe.id) rather than
// composing a new recipe the way the "+ New recipe" flow does.
async function onBeanPicked(bean) {
  showBeanChooser.value = false;
  const ok = await openConfirm({ title: t('espresso.confirmReplaceBean'), confirmLabel: t('common.replace') });
  if (!ok) return;
  await setRecipeBean(bean);
  // The swap came from a bubble inside the recipe overlay, and the recipe it
  // was browsing has now changed — so the browser has done its job. A
  // cancelled pick leaves the overlay open to try again.
  showRecipeOverlay.value = false;
}
async function pickGrinder() {
  const grinderId = await openChooser({
    title: t('recipePicker.chooseGrinder'),
    options: grinders.value.map((g) => [g.id, formatGrinderLabel(g)]),
    current: recipe.grinderId,
  });
  if (grinderId == null) return;
  const grinder = grinders.value.find((g) => g.id === grinderId);
  if (!grinder) return;
  // Nothing to replace when the recipe never had a grinder (composed before any
  // existed) — only confirm when the pick actually overwrites one.
  const hadGrinder = recipe.grinderId != null || (recipe.grinderModel && recipe.grinderModel !== '—');
  if (hadGrinder) {
    const ok = await openConfirm({ title: t('espresso.confirmReplaceGrinder'), confirmLabel: t('common.replace') });
    if (!ok) return;
  }
  await setRecipeGrinder(grinder);
  showRecipeOverlay.value = false;
}

async function onProfileSelected(profile) {
  const ok = await openConfirm({ title: t('espresso.confirmReplaceProfile'), confirmLabel: t('common.replace') });
  if (!ok) { showProfilePicker.value = false; return; }
  recipe.profileTitle = profile.profile?.title || '—';
  recipe.selectedProfileId = profile.id ?? null;
  // Copy, not reference: the recipe now owns this profile and can diverge
  // from the library one it was picked from (see useRecipe.js's recipe.profile).
  recipe.profile = cloneProfile(profile.profile);
  // Rebaseline the temperature dial to the NEW profile's own — same resolution
  // order as composeNewRecipe/applyEditedProfile (groupTemp, else first frame's
  // temperature, else tank_temperature). Without this the dial kept showing
  // whatever the PREVIOUS profile was brewed at, and buildGatewayPayload shifts
  // every frame by (recipe.groupTemp - resolveProfileTemp(profile)) — so a stale
  // dial would silently re-shift the new profile's temperatures on push too.
  recipe.groupTemp = NSXCore.resolveProfileTemp(profile.profile) ?? recipe.groupTemp;
  await pushRecipe();
  showProfilePicker.value = false;
  showRecipeOverlay.value = false; // see onBeanPicked
}

async function onProfileEditorSaved({ profile }) {
  await applyEditedProfile(profile);
  showProfileEditor.value = false;
}

async function onRoastConfirm(iso) {
  await setRoastDate(iso);
  showRoastPicker.value = false;
}
</script>

<template>
  <section class="page espresso-page">
    <!-- In the graph layout the title moves into the graph column itself
         (RecipeBrowser.vue) so the list on the left can use the freed space
         and start higher, right under the status island. -->
    <div v-if="!hasRecipe || !skinSettings.coffeeGraph" class="page-title">{{ t('espresso.pageTitle') }}</div>
    <div v-if="!hasRecipe" class="empty-recipe">
      <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.bean"></svg>
      <span class="empty-title">{{ t('espresso.emptyTitle') }}</span>
      <span class="empty-sub">{{ t('espresso.emptySub') }}</span>
      <button class="btn accent" @click="showRecipeCreator = true">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.profile"></svg>{{ t('espresso.createFirstRecipe') }}
      </button>
    </div>

    <template v-else-if="skinSettings.coffeeGraph">
      <RecipeBrowser @edit="showRecipeEditor = true" />
      <div v-if="showRecipeEditor" class="overlay-full">
        <!-- balanced: plain .ov-top centers .ov-title (flex:1) in whatever
             space is LEFT after .ov-back, not the row itself, so the label
             sits shifted right of true centre. .balanced is the app's own
             fix for that (see AppPanel/GrinderPanel/MachinePanel/SkinPanel/
             VisualizerPanel) — a 1fr/auto/1fr grid that balances .ov-back's
             width with an equal empty column on the right. -->
        <div class="ov-top balanced">
          <button class="ov-back" @click="showRecipeEditor = false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
          </button>
          <span class="ov-title">{{ t('espresso.editRecipe') }}</span>
        </div>
        <!-- The identity title button RecipeBody normally shows here is
             replaced (inside RecipeBody itself, when show-history is false)
             by the same three tappable Bean/Grinder/Profile bubbles
             <RecipeOverlay> uses — same handlers, so a pick here works
             identically to picking it from there. -->
        <RecipeBody
          :show-history="false"
          @open-recipes="showRecipeOverlay = true"
          @open-bean="showBeanChooser = true"
          @open-grinder="pickGrinder"
          @open-profile="showProfilePicker = true"
          @open-roast="showRoastPicker = true"
          @edit-profile="showProfileEditor = true"
        />
      </div>
    </template>

    <RecipeBody
      v-else
      @open-recipes="showRecipeOverlay = true"
      @open-roast="showRoastPicker = true"
      @edit-profile="showProfileEditor = true"
    />

    <RecipeOverlay
      v-if="showRecipeOverlay"
      @close="showRecipeOverlay = false"
      @pick-bean="showBeanChooser = true"
      @pick-grinder="pickGrinder"
      @pick-profile="showProfilePicker = true"
    />
    <RecipePicker
      v-if="showRecipeCreator"

      @back="showRecipeCreator = false"
      @created="showRecipeCreator = false"
    />
    <BeanChooser v-if="showBeanChooser" @pick="onBeanPicked" @back="showBeanChooser = false" />
    <ProfilePicker
      v-if="showProfilePicker"
      mode="pick"
      :current-title="recipe.profileTitle"
      @select="onProfileSelected"
      @back="showProfilePicker = false"
    />
    <RoastDatePicker
      v-if="showRoastPicker"
      :model-value="recipe.roastDate"
      @confirm="onRoastConfirm"
      @cancel="showRoastPicker = false"
    />
    <ProfileEditor
      v-if="showProfileEditor"
      mode="recipe"
      :profile="recipe.profile"
      @close="showProfileEditor = false"
      @saved="onProfileEditorSaved"
    />
  </section>
</template>
