<script setup>
/**
 * Phone recipe detail/edit — opened by tapping a row in RecipesTab, for ANY
 * library entry, not just the one loaded on the machine. That is the whole
 * complication this file exists to handle: every value/edit function below
 * has to work whether or not `entry` is the loaded recipe.
 *
 * Two data sources, picked once as `source`:
 *   - loaded (recipe.id === entry.id): read/write straight through the same
 *     reactive `recipe` singleton and setters EspressoView.vue uses
 *     (pushRecipe/setRecipeRating/setRoastDate/setRecipeBean/setRecipeGrinder)
 *     — those already push to the machine AND persist the library entry
 *     (pushRecipe -> persistCurrentRecipeEdits), so nothing extra is needed.
 *   - not loaded: read the library array, write through patchRecipeEntry
 *     (useRecipe.js) — persists only, never touches the machine.
 *
 * Roast date and bean are the one place this split isn't just "which
 * function to call": they resolve a real batch record via ensureRecipeBatch,
 * which only runs inside pushRecipe on the LOADED recipe, and selectRecipe
 * ignores a library entry's raw `roastDate` field entirely (it re-derives
 * the date from beanBatchId on load) — patching it directly here would look
 * like it worked and then silently revert the next time this recipe loads.
 * So those two rows only appear once this entry IS the loaded one; every
 * other field is safe to edit either way (see patchRecipeEntry's own doc).
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders, profiles, formatGrinderLabel, singleGrinder, recipeIdentityParts, formatShortDate } from '../../composables/useCore.js';
import {
  recipe, recipes, pushRecipe, deleteRecipe, togglePinRecipe, patchRecipeEntry,
  setRoastDate, setRecipeRating, setRecipeBean, setRecipeGrinder, roastAge, beanForRecipe,
} from '../../composables/useRecipe.js';
import { openNumberPad, openRating, openChooser, openConfirm } from '../../composables/useModals.js';
import { skinSettings } from '../../composables/useSettings.js';
import BatchPicker from '../BatchPicker.vue';
import BeanChooser from '../BeanChooser.vue';
import ProfilePicker from '../ProfilePicker.vue';
import StarRating from '../StarRating.vue';
import { dispTemp, fmtTemp, toCelsius, tempUnitLabel } from '../../composables/useUnits.js';

const props = defineProps({ entry: { type: Object, required: true } });
const emit = defineEmits(['close']);
const { t } = useI18n();

// The library's own copy of this entry — kept fresh by patchRecipeEntry (it
// reassigns `recipes.value`), so this reacts to every edit made here.
const libraryEntry = computed(() => recipes.value.find((r) => r.id === props.entry.id) ?? props.entry);
const isLoaded = computed(() => recipe.id != null && recipe.id === props.entry.id);
const source = computed(() => (isLoaded.value ? recipe : libraryEntry.value));

const titleParts = computed(() => recipeIdentityParts(source.value));

// roastAge is only meaningful for the LOADED recipe — it reads the live
// batch, which a non-loaded entry's raw roastDate field can't stand in for
// (see the roast-date note above). The row itself is loaded-only anyway.
const roastLabel = computed(() =>
  source.value.roastDate ? `${formatShortDate(source.value.roastDate)} · ${roastAge.value}` : t('espresso.setRoastDate')
);

async function editDose() {
  const v = await openNumberPad({ title: t('espresso.dose'), unit: 'g', value: (Number(source.value.targetDoseWeight) || 0).toFixed(1) });
  if (v == null) return;
  const value = parseFloat(v);
  if (isLoaded.value) { recipe.targetDoseWeight = value; await pushRecipe(); }
  else await patchRecipeEntry(props.entry.id, { targetDoseWeight: value });
}
async function editGrind() {
  const v = await openNumberPad({ title: t('espresso.grindSize'), value: source.value.grinderSetting, multiPoint: true });
  if (v == null) return;
  if (isLoaded.value) { recipe.grinderSetting = v; await pushRecipe(); }
  else await patchRecipeEntry(props.entry.id, { grinderSetting: v });
}
// Same linked dose:yield ratio field as EspressoView.editYield — dose stays
// fixed, editing either the yield grams or the "1:x" ratio keeps the other
// in sync live (NumberPad.vue's `linked` support).
async function editYield() {
  const dose = Number(source.value.targetDoseWeight) || 0;
  const v = await openNumberPad({
    title: t('espresso.targetYield'), unit: 'g', value: (Number(source.value.targetYield) || 0).toFixed(1),
    linked: dose > 0 ? {
      label: t('espresso.ratio'), unit: '', prefix: '1 : ',
      value: (source.value.targetYield / dose).toFixed(1),
      toLinked: (yieldValue) => (yieldValue / dose).toFixed(1),
      toPrimary: (ratioValue) => (Math.round(dose * ratioValue * 10) / 10).toFixed(1),
    } : null,
  });
  if (v == null) return;
  const value = parseFloat(v);
  if (isLoaded.value) { recipe.targetYield = value; await pushRecipe(); }
  else await patchRecipeEntry(props.entry.id, { targetYield: value });
}
async function editTemp() {
  const v = await openNumberPad({ title: t('espresso.stopAtTemp'), unit: tempUnitLabel.value, value: String(dispTemp(source.value.groupTemp)) });
  if (v == null) return;
  const value = toCelsius(parseFloat(v));
  if (isLoaded.value) { recipe.groupTemp = value; await pushRecipe(); }
  else await patchRecipeEntry(props.entry.id, { groupTemp: value });
}
async function toggleStopAtWeight() {
  const value = !source.value.stopAtWeight;
  if (isLoaded.value) { recipe.stopAtWeight = value; await pushRecipe(); }
  else await patchRecipeEntry(props.entry.id, { stopAtWeight: value });
}
async function pickGrinder() {
  const grinderId = await openChooser({
    title: t('recipePicker.chooseGrinder'),
    options: grinders.value.map((g) => [g.id, formatGrinderLabel(g)]),
    current: source.value.grinderId,
  });
  if (grinderId == null) return;
  const grinder = grinders.value.find((g) => g.id === grinderId);
  if (!grinder) return;
  if (isLoaded.value) await setRecipeGrinder(grinder);
  else await patchRecipeEntry(props.entry.id, { grinderId: grinder.id, grinderModel: grinder.model || '—' });
}
async function openRateRow() {
  const v = await openRating({ title: t('rating.title'), value: source.value.rating });
  if (v === null) return;
  if (isLoaded.value) await setRecipeRating(v);
  else await patchRecipeEntry(props.entry.id, { rating: Math.max(0, Math.min(5, Number(v) || 0)) });
}

// Roast row is loaded-only (see file header), so this always reads off the
// live `recipe`, not `source`.
const recipeBean = computed(() => beanForRecipe(recipe));
const showBatchPicker = ref(false);
async function onBatchPicked(batch) {
  await setRoastDate(batch.roastDate);
  showBatchPicker.value = false;
}
const showBeanChooser = ref(false);
async function onBeanPicked(bean) {
  showBeanChooser.value = false;
  await setRecipeBean(bean);
}

// Unlike roast date/bean, swapping the profile has no batch to resolve — it's
// the same three fields either way (EspressoView.onProfileSelected), so this
// is safe on a non-loaded entry too and doesn't need the loaded-only guard
// those two rows carry.
const showProfilePicker = ref(false);
async function onProfileSelected(profile) {
  const profileTitle = profile.profile?.title || '—';
  // Reference only — see useRecipe.js's `selectedProfileId` note on `recipe`.
  const selectedProfileId = profile.id ?? null;
  // Rebaseline the temperature dial to the NEW profile's own, same resolution
  // order as EspressoView/composeNewRecipe — otherwise a stale dial silently
  // re-shifts every frame's temperature on the next push (buildGatewayPayload
  // shifts by recipe.groupTemp minus the profile's own resolved temp).
  const groupTemp = window.NSXCore.resolveProfileTemp(profile.profile) ?? source.value.groupTemp;
  if (isLoaded.value) {
    Object.assign(recipe, { profileTitle, selectedProfileId, groupTemp });
    await pushRecipe();
  } else {
    await patchRecipeEntry(props.entry.id, { profileTitle, selectedProfileId, groupTemp });
  }
  showProfilePicker.value = false;
}

/**
 * The selected profile's own curve, drawn above the Brew group.
 *
 * A recipe stores only a REFERENCE to a library profile (id, falling back to
 * title — see useRecipe's selectedProfileId note), so resolve it the same way
 * buildGatewayPayload does before handing it to core's renderer. The renderer
 * is the one ProfilePicker's detail pane uses, with the same options: no
 * legend, no ticks, no temperature line, margins collapsed so it fills the
 * card rather than letterboxing.
 *
 * Reading skinSettings.theme here is deliberate — it makes the SVG re-render
 * when the theme changes, since the renderer paints its own background.
 */
const selectedProfile = computed(() => {
  const id = source.value.selectedProfileId;
  const title = String(source.value.profileTitle || '').trim();
  return profiles.value.find((p) => p.id === id)
    ?? profiles.value.find((p) => String(p.profile?.title || '').trim() === title)
    ?? null;
});
const profileSvg = computed(() => (selectedProfile.value
  ? window.NSXCore.renderProfileSpark(selectedProfile.value.profile, {
    theme: skinSettings.theme === 'light' ? 'light' : 'dark',
    showLegend: false, showXTicks: false, showYTicks: false, showStageLabels: false,
    showTempLine: false, compactMargins: true, pressureMax: 12,
    dose: Number(source.value.targetDoseWeight) || 18,
  })
  : ''));

async function pin() {
  await togglePinRecipe(libraryEntry.value);
}
async function removeThis() {
  const ok = await openConfirm({
    title: t('diary.deleteRecipeConfirm'),
    message: `${source.value.coffeeRoaster} – ${source.value.coffeeName}`,
    danger: true,
    confirmLabel: t('common.delete'),
  });
  if (ok) { await deleteRecipe(props.entry.id); emit('close'); }
}
</script>

<template>
  <div class="overlay-full">
    <!-- The back button's row holds nothing that can crowd it: the title
         used to share it, and a long roaster/bean name pushed the button
         down to a sliver nobody could hit. The Loaded badge stays up here,
         at the far end. -->
    <div class="phone-head">
      <button class="phone-back" :aria-label="t('common.back')" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span v-if="isLoaded" class="phone-badge phone-head-end">{{ t('phone.loaded') }}</span>
    </div>
    <!-- The title on a line of its own, below. Stacked, not dot-joined: a
         4-part identity (roaster / bean / grinder / profile) on one line ran
         out of room and ellipsised the very part — the profile — that tells
         two recipes for the same bean apart, so each part gets its own line.
         Roaster and bean are one identity (the coffee) and share this line's
         weight; only grinder/profile beyond them step down to .rsub. -->
    <span class="phone-identity-stack phone-detail-title">
      <span v-for="(part, i) in titleParts" :key="i" :class="i < 2 ? 'phone-identity-line' : 'rsub'">{{ part }}</span>
    </span>

    <!-- The fields scroll; the back row, the title and the action footer
         don't. .overlay-full is a COLUMN FLEX container, so without this
         every child simply shrank to fit once the content outgrew the screen
         — which is what collapsed the profile plot to nothing rather than
         pushing anything off the bottom. -->
    <div class="phone-main">
      <!-- Half-width tiles in a two-column grid, grouped by the question they
           answer: which coffee, how it's ground, how it's brewed. One long
           undifferentiated column of full-width rows made you read every label
           to find one field; at half width two fit side by side and a group is
           one glance. Label over value (not label-left/value-right) because a
           half-width row has no room for both on one line. -->
      <span class="phone-group-label">{{ t('phone.grpCoffee') }}</span>
      <div class="phone-grid">
        <!-- Bean and Batch are loaded-recipe only — see the file header: they
             resolve a real batch record, and patching them on a library entry
             would look like it worked and silently revert on next load. -->
        <button v-if="isLoaded" class="phone-tile" @click="showBeanChooser = true">
          <span class="tl">{{ t('espresso.bean') }}</span>
          <span class="tv">{{ source.coffeeName }}</span>
        </button>
        <button v-if="isLoaded" class="phone-tile" @click="recipeBean && (showBatchPicker = true)">
          <span class="tl">{{ t('espresso.roasted') }}</span>
          <span class="tv">{{ roastLabel }}</span>
        </button>
        <button class="phone-tile" @click="editDose">
          <span class="tl">{{ t('espresso.dose') }}</span>
          <span class="tv">{{ (Number(source.targetDoseWeight) || 0).toFixed(1) }} g</span>
        </button>
      </div>

      <span class="phone-group-label">{{ t('phone.grpGrind') }}</span>
      <div class="phone-grid">
        <button v-if="!singleGrinder" class="phone-tile" @click="pickGrinder">
          <span class="tl">{{ t('espresso.grinder') }}</span>
          <span class="tv">{{ source.grinderModel }}</span>
        </button>
        <button class="phone-tile" @click="editGrind">
          <span class="tl">{{ t('espresso.grindSize') }}</span>
          <span class="tv">{{ source.grinderSetting }}</span>
        </button>
      </div>

      <span class="phone-group-label">{{ t('phone.grpBrew') }}</span>
      <!-- The profile's own curve, above the group it belongs to: the title
           alone ("D-Flow / default") says nothing about what the shot will do,
           and this is the one field here you can't judge from its value. -->
      <div v-if="profileSvg" class="phone-profile-plot" v-html="profileSvg"></div>
      <div class="phone-grid">
        <!-- Two columns: "D-Flow / default" is the longest value on the page
             and the one that actually tells two recipes for the same bean
             apart, so a half tile ellipsised away the useful half of it. -->
        <button class="phone-tile phone-tile-wide" @click="showProfilePicker = true">
          <span class="tl">{{ t('espresso.profile') }}</span>
          <span class="tv">{{ source.profileTitle }}</span>
        </button>
        <button class="phone-tile" @click="editYield">
          <span class="tl">{{ t('espresso.targetYield') }}</span>
          <span class="tv">{{ (Number(source.targetYield) || 0).toFixed(1) }} g</span>
        </button>
        <button class="phone-tile" @click="editTemp">
          <span class="tl">{{ t('espresso.stopAtTemp') }}</span>
          <span class="tv">{{ fmtTemp(source.groupTemp) }}</span>
        </button>
        <!-- A tile like the rest, but its value IS the control. -->
        <div class="phone-tile">
          <span class="tl">{{ t('espresso.stopAtWeight') }}</span>
          <span class="tv">
            <button
              class="switch sm" :class="{ on: source.stopAtWeight }" role="switch"
              :aria-checked="!!source.stopAtWeight" @click="toggleStopAtWeight"
            ></button>
          </span>
        </div>
        <!-- Rate finishes the row the toggle starts. It was a full-width
             tile in a grid of its own below, which had no gap above it and so
             read as if it had come loose from the group. -->
        <button class="phone-tile" @click="openRateRow">
          <span class="tl">{{ t('rating.rate') }}</span>
          <span class="tv">
            <StarRating v-if="Number(source.rating) > 0" :model-value="Number(source.rating)" readonly :size="16" />
            <template v-else>{{ t('rating.unrated') }}</template>
          </span>
        </button>
      </div>

      <!-- Inside the scroll, at the very bottom of the recipe: these two act
           on the recipe as a whole rather than on any field, and a fixed bar
           kept Delete on screen the entire time you were editing. You reach
           them by finishing the page, which is the right amount of effort for
           the only destructive thing here. -->
      <div class="phone-detail-footer">
        <button class="btn" @click="pin">{{ libraryEntry.pinned ? t('diary.unpin') : t('diary.pin') }}</button>
        <button class="btn danger" @click="removeThis">{{ t('common.delete') }}</button>
      </div>
    </div>


    <PageTransition>
      <BatchPicker
        v-if="showBatchPicker && recipeBean"
        :bean="recipeBean"
        @pick="onBatchPicked"
        @back="showBatchPicker = false"
      />
    </PageTransition>
    <PageTransition>
      <BeanChooser v-if="showBeanChooser" @pick="onBeanPicked" @back="showBeanChooser = false" />
    </PageTransition>
    <PageTransition>
      <ProfilePicker
        v-if="showProfilePicker"
        mode="pick"
        :current-title="source.profileTitle"
        @select="onProfileSelected"
        @back="showProfilePicker = false"
      />
    </PageTransition>
  </div>
</template>
