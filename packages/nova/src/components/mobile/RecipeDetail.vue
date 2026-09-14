<script setup>
/**
 * Phone recipe detail/edit — opened by RecipesTab's pencil button for ANY
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
import { grinders, formatGrinderLabel, singleGrinder, recipeIdentityParts, formatShortDate } from '../../composables/useCore.js';
import {
  recipe, recipes, pushRecipe, selectRecipe, deleteRecipe, togglePinRecipe, patchRecipeEntry,
  setRoastDate, setRecipeRating, setRecipeBean, setRecipeGrinder, roastAge,
} from '../../composables/useRecipe.js';
import { openNumberPad, openRating, openChooser, openConfirm } from '../../composables/useModals.js';
import { showToast } from '../../composables/useToast.js';
import RoastDatePicker from '../RoastDatePicker.vue';
import BeanChooser from '../BeanChooser.vue';
import ProfilePicker from '../ProfilePicker.vue';
import StarRating from '../StarRating.vue';

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
  const v = await openNumberPad({ title: t('espresso.grindSize'), value: source.value.grinderSetting });
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
  const v = await openNumberPad({ title: t('espresso.stopAtTemp'), unit: '°C', value: String(source.value.groupTemp) });
  if (v == null) return;
  const value = parseFloat(v);
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

const showRoastPicker = ref(false);
async function onRoastConfirm(iso) {
  await setRoastDate(iso);
  showRoastPicker.value = false;
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

async function loadOntoMachine() {
  await selectRecipe(libraryEntry.value);
  showToast(t('phone.recipeLoaded', { name: titleParts.value.join(' • ') }));
}
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
    <div class="phone-head">
      <button class="phone-back" :aria-label="t('common.back')" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <!-- Stacked, not dot-joined on one line: a 4-part identity (roaster /
           bean / grinder / profile) ran out of room on a phone-width header
           and ellipsised the very part — the profile — that tells two rows
           for the same bean apart. Full room here, so each part gets its own
           line instead. -->
      <span class="phone-crumb phone-identity-stack">
        <!-- Roaster and bean are one identity (the coffee) and share this
             line's weight; only grinder/profile beyond them step down to
             .rsub. -->
        <span v-for="(part, i) in titleParts" :key="i" :class="i < 2 ? 'phone-identity-line' : 'rsub'">{{ part }}</span>
      </span>
      <span v-if="isLoaded" class="phone-badge">{{ t('phone.loaded') }}</span>
    </div>

    <div class="phone-list">
      <button class="phone-list-row" @click="editDose">
        <span class="rmeta">{{ t('espresso.dose') }}</span>
        <span class="phone-row-value">{{ (Number(source.targetDoseWeight) || 0).toFixed(1) }} g<span class="chev">›</span></span>
      </button>
      <button class="phone-list-row" @click="editGrind">
        <span class="rmeta">{{ t('espresso.grindSize') }}</span>
        <span class="phone-row-value">{{ source.grinderSetting }}<span class="chev">›</span></span>
      </button>
      <button class="phone-list-row" @click="editYield">
        <span class="rmeta">{{ t('espresso.targetYield') }}</span>
        <span class="phone-row-value">{{ (Number(source.targetYield) || 0).toFixed(1) }} g<span class="chev">›</span></span>
      </button>
      <div class="phone-list-row">
        <span class="rmeta">{{ t('espresso.stopAtWeight') }}</span>
        <button class="switch" :class="{ on: source.stopAtWeight }" role="switch" :aria-checked="!!source.stopAtWeight" @click="toggleStopAtWeight"></button>
      </div>
      <button class="phone-list-row" @click="editTemp">
        <span class="rmeta">{{ t('espresso.stopAtTemp') }}</span>
        <span class="phone-row-value">{{ source.groupTemp }} °C<span class="chev">›</span></span>
      </button>
      <button v-if="!singleGrinder" class="phone-list-row" @click="pickGrinder">
        <span class="rmeta">{{ t('espresso.grinder') }}</span>
        <span class="phone-row-value">{{ source.grinderModel }}<span class="chev">›</span></span>
      </button>
      <button class="phone-list-row" @click="showProfilePicker = true">
        <span class="rmeta">{{ t('espresso.profile') }}</span>
        <span class="phone-row-value">{{ source.profileTitle }}<span class="chev">›</span></span>
      </button>

      <!-- Roast date / bean: loaded-recipe only — see the file header. -->
      <button v-if="isLoaded" class="phone-list-row" @click="showRoastPicker = true">
        <span class="rmeta">{{ t('espresso.roasted') }}</span>
        <span class="phone-row-value">{{ roastLabel }}<span class="chev">›</span></span>
      </button>
      <button v-if="isLoaded" class="phone-list-row" @click="showBeanChooser = true">
        <span class="rmeta">{{ t('espresso.bean') }}</span>
        <span class="phone-row-value">{{ source.coffeeName }}<span class="chev">›</span></span>
      </button>

      <button class="phone-list-row" @click="openRateRow">
        <span class="rmeta">{{ t('rating.rate') }}</span>
        <StarRating v-if="Number(source.rating) > 0" :model-value="Number(source.rating)" readonly :size="16" />
        <span v-else class="phone-row-value">{{ t('rating.unrated') }}<span class="chev">›</span></span>
      </button>
    </div>

    <div class="phone-detail-footer">
      <button class="btn accent" @click="loadOntoMachine">{{ t('diary.loadRecipe') }}</button>
      <button class="btn" @click="pin">{{ libraryEntry.pinned ? t('diary.unpin') : t('diary.pin') }}</button>
      <button class="btn danger" @click="removeThis">{{ t('common.delete') }}</button>
    </div>

    <RoastDatePicker
      v-if="showRoastPicker"
      :model-value="recipe.roastDate"
      @confirm="onRoastConfirm"
      @cancel="showRoastPicker = false"
    />
    <BeanChooser v-if="showBeanChooser" @pick="onBeanPicked" @back="showBeanChooser = false" />
    <ProfilePicker
      v-if="showProfilePicker"
      mode="pick"
      :current-title="source.profileTitle"
      @select="onProfileSelected"
      @back="showProfilePicker = false"
    />
  </div>
</template>
