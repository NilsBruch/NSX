<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders, formatGrinderLabel, profiles, profilesAll, refreshProfilesAll, saveLibraryProfile } from '../composables/useCore.js';
import { showToast } from '../composables/useToast.js';
import { recipe, pushRecipe, setRoastDate, setRecipeBean, setRecipeGrinder, applyEditedLibraryProfile, beanForRecipe } from '../composables/useRecipe.js';
import { openChooser, openConfirm } from '../composables/useModals.js';
import { skinSettings } from '../composables/useSettings.js';
import RecipePicker from '../components/RecipePicker.vue';
import RecipeOverlay from '../components/RecipeOverlay.vue';
import RecipeBody from '../components/RecipeBody.vue';
import RecipeBrowser from '../components/RecipeBrowser.vue';
import ProfilePicker from '../components/ProfilePicker.vue';
import BatchPicker from '../components/BatchPicker.vue';
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

// The blurred recipe browser, opened by tapping the classic layout's combined
// identity title (RecipeBody.vue). The graph layout has no such title — its
// own recipe card list is already the browser — so this is classic-only.
const showRecipeOverlay = ref(false);
const showProfilePicker = ref(false);
const showBatchPicker = ref(false);
const showProfileEditor = ref(false);
const showBeanChooser = ref(false);
// The bean->profile creation wizard — the same entry point the Diary's "+" uses.
const showRecipeCreator = ref(false);

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
  // Reference only — see useRecipe.js's `selectedProfileId` note on `recipe`.
  recipe.selectedProfileId = profile.id ?? null;
  // Rebaseline the temperature dial to the NEW profile's own — same resolution
  // order as composeNewRecipe/applyEditedLibraryProfile (groupTemp, else first frame's
  // temperature, else tank_temperature). Without this the dial kept showing
  // whatever the PREVIOUS profile was brewed at, and buildGatewayPayload shifts
  // every frame by (recipe.groupTemp - resolveProfileTemp(profile)) — so a stale
  // dial would silently re-shift the new profile's temperatures on push too.
  recipe.groupTemp = NSXCore.resolveProfileTemp(profile.profile) ?? recipe.groupTemp;
  await pushRecipe();
  showProfilePicker.value = false;
  showRecipeOverlay.value = false; // see onBeanPicked
}

// The recipe's REFERENCED library profile — resolved from the visible cache
// first, falling back to visible+hidden (a recipe can point at a hidden one,
// e.g. a superseded version still in flight — see buildGatewayPayload), and
// finally by title (mirrors buildGatewayPayload's own id-then-title fallback,
// for the rare case a stored id no longer exists at all).
const editingProfileRecord = computed(() => {
  const byId = (id) => profiles.value.find((p) => p.id === id) ?? profilesAll.value.find((p) => p.id === id);
  const byTitle = (title) => profiles.value.find((p) => p.profile?.title === title) ?? profilesAll.value.find((p) => p.profile?.title === title);
  return byId(recipe.selectedProfileId) ?? byTitle(recipe.profileTitle) ?? null;
});

async function openProfileEditor() {
  // Lazily fill the hidden cache so a recipe pointing at a hidden/superseded
  // profile can still be found above — matches ProfilePicker's own convention.
  if (!profilesAll.value.length) await refreshProfilesAll();
  showProfileEditor.value = true;
}

async function onProfileEditorSaved({ profile: built, originalProfile }) {
  try {
    const savedRecord = await saveLibraryProfile({ record: editingProfileRecord.value, built, originalProfile });
    await applyEditedLibraryProfile(savedRecord);
  } catch (err) {
    // A refusal is not a failure to log and walk away from: the gateway could
    // not create what was asked for, and the way out is another edit — so say
    // why and leave the editor open on the work.
    if (err?.name === 'ProfileSaveRefused') {
      showToast(t(`profileEditor.refused_${err.reason}`));
      return;
    }
    console.error('[Nova] failed to save profile', err?.message);
    showToast(t('profileEditor.saveFailed'));
  }
  showProfileEditor.value = false;
}

// The bean the loaded recipe stands on — null for a beanUnlinked recipe (its
// bean was deleted and this one deliberately kept, see useRecipe.js), which
// has no bags to browse, so the roast badge below becomes a no-op for it.
const recipeBean = computed(() => beanForRecipe(recipe));

function openBatchPicker() {
  if (!recipeBean.value) return;
  showBatchPicker.value = true;
}

// BatchPicker already resolved (or, for "+ Add batch", created) the batch —
// setRoastDate's own resolution (NSXCore.resolveBatch, find-or-create) is
// idempotent for an existing date, so this just re-attaches the SAME batch
// to the recipe rather than re-picking a bag from scratch.
async function onBatchPicked(batch) {
  await setRoastDate(batch.roastDate);
  showBatchPicker.value = false;
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

    <RecipeBrowser
      v-else-if="skinSettings.coffeeGraph"
      @edit-profile="openProfileEditor"
      @open-roast="openBatchPicker"
      @pick-bean="showBeanChooser = true"
      @pick-grinder="pickGrinder"
      @pick-profile="showProfilePicker = true"
    />

    <RecipeBody
      v-else
      @open-recipes="showRecipeOverlay = true"
      @open-roast="openBatchPicker"
      @edit-profile="openProfileEditor"
    />

    <RecipeOverlay
      v-if="showRecipeOverlay"
      @close="showRecipeOverlay = false"
      @pick-bean="showBeanChooser = true"
      @pick-grinder="pickGrinder"
      @pick-profile="showProfilePicker = true"
    />
    <PageTransition>
      <RecipePicker
        v-if="showRecipeCreator"

        @back="showRecipeCreator = false"
        @created="showRecipeCreator = false"
      />
    </PageTransition>
    <PageTransition>
      <BeanChooser v-if="showBeanChooser" @pick="onBeanPicked" @back="showBeanChooser = false" />
    </PageTransition>
    <PageTransition>
      <ProfilePicker
        v-if="showProfilePicker"
        mode="pick"
        :current-title="recipe.profileTitle"
        @select="onProfileSelected"
        @back="showProfilePicker = false"
      />
    </PageTransition>
    <PageTransition>
      <BatchPicker
        v-if="showBatchPicker && recipeBean"
        :bean="recipeBean"
        @pick="onBatchPicked"
        @back="showBatchPicker = false"
      />
    </PageTransition>
    <PageTransition>
      <ProfileEditor
        v-if="showProfileEditor"
        :record="editingProfileRecord"
        @close="showProfileEditor = false"
        @saved="onProfileEditorSaved"
      />
    </PageTransition>
  </section>
</template>
