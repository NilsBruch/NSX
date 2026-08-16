<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { singleGrinder, grinders, formatGrinderLabel } from '../composables/useCore.js';
import { recipe, roastAge, pushRecipe, setRoastDate, setRecipeRating, setRecipeBean, setRecipeGrinder, cloneProfile, applyEditedProfile } from '../composables/useRecipe.js';
import { loadHistoryForCurrentRecipe } from '../composables/useLiveShot.js';
import { openNumberPad, openRating, openChooser, openConfirm } from '../composables/useModals.js';
import { useDragDial, DIAL_PX_PER_STEP } from '../composables/useDragDial.js';
import RecipePicker from '../components/RecipePicker.vue';
import ProfilePicker from '../components/ProfilePicker.vue';
import RoastDatePicker from '../components/RoastDatePicker.vue';
import BeanChooser from '../components/BeanChooser.vue';
import ProfileEditor from '../components/settings/ProfileEditor.vue';
import StarRating from '../components/StarRating.vue';

const { t } = useI18n();
const { NSXCore } = window;

const ICONS = {
  thermo: '<path d="M10 4a2 2 0 0 1 4 0v9a4.5 4.5 0 1 1-4 0V4z"/><path d="M12 9v6"/>',
  bean: '<path d="M7 7c3-4 9-3 10 1s-3 10-8 9-5-6-2-10z"/><path d="M9 8c2 2 4 3 6 7"/>',
  cup: '<path d="M5 8h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z"/><path d="M16 9h1.5a2 2 0 0 1 0 4H16"/>',
  // Gear = grind-size adjustment. Feather-style cog: a toothed ring around a hub.
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  profile: '<path d="M4 19h16"/><path d="M4 16c3 0 3-9 6-9s3 6 5 6 3-2 5-2"/>',
  // Stacked-lines "library" glyph for the Recipes button.
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  drop: '<path d="M12 3.5s5.5 6.3 5.5 10a5.5 5.5 0 0 1-11 0c0-3.7 5.5-10 5.5-10z"/><path d="M9.5 14.5a2.8 2.8 0 0 0 2.3 2.7"/>',
};

// Same "nothing loaded yet" signal the old title placeholder used (first
// launch, or adoptCurrentWorkflowAsRecipe finding no roaster/name at boot —
// see useRecipe.js). The tiles/roast-chip/history below are all meaningless
// without a bean+profile behind them, so they're replaced by an empty state
// rather than showing 0g/0°C and a roast-date chip with no bean to attach to.
const hasRecipe = computed(() => {
  const roaster = recipe.coffeeRoaster;
  const name = recipe.coffeeName;
  return !!(roaster && roaster !== '—' && name && name !== '—');
});

// The grinder tile's burr-set sub-line — looked up by id (falling back to a
// model-name match for legacy recipes with no grinderId), since `recipe`
// itself only stores the model string, not the burrs.
const currentGrinderBurrs = computed(() => {
  const g = grinders.value.find((x) => x.id === recipe.grinderId) ?? grinders.value.find((x) => x.model === recipe.grinderModel);
  return g?.burrs || '';
});

function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
const roastLabel = computed(() =>
  recipe.roastDate ? `${t('espresso.roasted')} ${fmtDate(recipe.roastDate)} · ${roastAge.value}` : t('espresso.setRoastDate')
);

const showRecipePicker = ref(false);
const showProfilePicker = ref(false);
const showRoastPicker = ref(false);
const showProfileEditor = ref(false);
const showBeanChooser = ref(false);
// Jumps straight to bean->profile creation, skipping the (empty) library list —
// same entry point the Diary's "+" uses (RecipePicker start-step="bean").
const showRecipeCreator = ref(false);

// Bean and grinder tiles' own pickers — see useRecipe.js's setRecipeBean/
// setRecipeGrinder for why these swap in place (same recipe.id) rather than
// composing a new recipe the way the "+ New recipe" flow does.
async function onBeanPicked(bean) {
  showBeanChooser.value = false;
  const ok = await openConfirm({ title: t('espresso.confirmReplaceBean'), confirmLabel: t('common.replace') });
  if (!ok) return;
  await setRecipeBean(bean);
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
  const ok = await openConfirm({ title: t('espresso.confirmReplaceGrinder'), confirmLabel: t('common.replace') });
  if (!ok) return;
  await setRecipeGrinder(grinder);
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
}

async function onProfileEditorSaved({ profile }) {
  await applyEditedProfile(profile);
  showProfileEditor.value = false;
}

async function onRoastConfirm(iso) {
  await setRoastDate(iso);
  showRoastPicker.value = false;
}

async function editDose() {
  const v = await openNumberPad({ title: t('espresso.dose'), unit: 'g', value: recipe.targetDoseWeight.toFixed(1) });
  if (v == null) return;
  recipe.targetDoseWeight = parseFloat(v);
  await pushRecipe();
}
async function editGrind() {
  const v = await openNumberPad({ title: t('espresso.grindSize'), value: recipe.grinderSetting });
  if (v == null) return;
  recipe.grinderSetting = v;
  await pushRecipe();
}
// The yield editor also shows the brew ratio (1:x) as a second, linked field
// in the SAME modal — dose stays fixed, so editing either the yield grams or
// the ratio's "x" keeps the other in sync live (see NumberPad.vue's `linked`
// support). No standalone ratio display on the recipe page itself — this is
// the only place it's surfaced, only while actually editing yield.
async function editYield() {
  const dose = recipe.targetDoseWeight;
  const v = await openNumberPad({
    title: t('espresso.targetYield'), unit: 'g', value: recipe.targetYield.toFixed(1),
    linked: dose > 0 ? {
      label: t('espresso.ratio'), unit: '', prefix: '1 : ',
      value: (recipe.targetYield / dose).toFixed(1),
      toLinked: (yieldValue) => (yieldValue / dose).toFixed(1),
      toPrimary: (ratioValue) => (Math.round(dose * ratioValue * 10) / 10).toFixed(1),
    } : null,
  });
  if (v == null) return;
  recipe.targetYield = parseFloat(v);
  await pushRecipe();
}
async function editTemp() {
  const v = await openNumberPad({ title: t('espresso.stopAtTemp'), unit: '°C', value: String(recipe.groupTemp) });
  if (v == null) return;
  recipe.groupTemp = parseFloat(v);
  await pushRecipe();
}

/**
 * Press-and-pull-to-adjust for the recipe dials (see useDragDial.js). Unlike
 * the machine-function domains (steam/hotwater), pushRecipe() has no internal
 * debounce — it's a full gateway round-trip PLUS ensureRecipeBatch() every
 * call — so it must NOT run on every pointermove pixel. useDragDial's
 * onCommit fires exactly once, on release, rather than on a trailing debounce:
 * a debounce still fires mid-drag if the finger pauses even briefly, which is
 * exactly the "pushed before I lifted my finger" bug this replaced.
 */
// Every dial uses the same feel: DIAL_PX_PER_STEP px of drag = one step (see
// useDragDial). pxPerUnit = DIAL_PX_PER_STEP / step converts that to px-per-unit.
const doseDrag = useDragDial({
  get: () => recipe.targetDoseWeight,
  set: (v) => { recipe.targetDoseWeight = v; },
  onCommit: () => pushRecipe(),
  min: 5, max: 30, step: 0.1, pxPerUnit: DIAL_PX_PER_STEP / 0.1,
});
const onDoseClick = doseDrag.guardClick(editDose);

// Grind step comes from the selected recipe's grinder (its "small step" in the
// grinder editor) so one drag tick matches that grinder's finest real adjustment
// — falling back to 1 when no grinder is set, it's not found, or it has no small
// step configured.
const grindStep = computed(() => {
  const g = grinders.value.find((x) => x.id === recipe.grinderId);
  const s = Number(g?.settingSmallStep);
  return Number.isFinite(s) && s > 0 ? s : 1;
});
// Grind: same feel, but the step is the grinder's own small step (a 0.1-step
// Niche needs the same finger travel per click as a 1-step grinder).
const grindDrag = useDragDial({
  get: () => parseFloat(recipe.grinderSetting) || 0,
  set: (v) => { recipe.grinderSetting = String(Math.round(v * 100) / 100); },
  onCommit: () => pushRecipe(),
  min: 0, max: 100,
  step: () => grindStep.value,
  pxPerUnit: () => DIAL_PX_PER_STEP / grindStep.value,
});
const onGrindClick = grindDrag.guardClick(editGrind);

const yieldDrag = useDragDial({
  get: () => recipe.targetYield,
  set: (v) => { recipe.targetYield = v; },
  onCommit: () => pushRecipe(),
  min: 10, max: 70, step: 0.1, pxPerUnit: DIAL_PX_PER_STEP / 0.1,
});
const onYieldClick = yieldDrag.guardClick(editYield);

const tempDrag = useDragDial({
  get: () => recipe.groupTemp,
  set: (v) => { recipe.groupTemp = v; },
  onCommit: () => pushRecipe(),
  min: 80, max: 100, step: 1, pxPerUnit: DIAL_PX_PER_STEP / 1,
});
const onTempClick = tempDrag.guardClick(editTemp);

async function toggleStopAtWeight() {
  recipe.stopAtWeight = !recipe.stopAtWeight;
  await pushRecipe();
}

async function openRateRecipe() {
  const v = await openRating({ title: t('rating.title'), value: recipe.rating });
  if (v !== null) await setRecipeRating(v);
}
</script>

<template>
  <section class="page espresso-page">
    <div class="page-title">{{ t('espresso.pageTitle') }}</div>
    <div v-if="!hasRecipe" class="empty-recipe">
      <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.bean"></svg>
      <span class="empty-title">{{ t('espresso.emptyTitle') }}</span>
      <span class="empty-sub">{{ t('espresso.emptySub') }}</span>
      <button class="btn accent" @click="showRecipeCreator = true">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.profile"></svg>{{ t('espresso.createFirstRecipe') }}
      </button>
    </div>

    <div v-else class="dials">
      <div class="dial-group">
        <span class="dial-label">{{ t('espresso.bean') }}</span>
        <button class="dial-id" :aria-label="t('espresso.changeBean')" @click="showBeanChooser = true">
          <span class="dial-id-name">{{ recipe.coffeeRoaster }}</span>
          <span class="dial-id-sub">{{ recipe.coffeeName }}</span>
        </button>
        <button
          class="dial"
          :class="{ dragging: doseDrag.dragging.value }"
          @click="onDoseClick"
          @pointerdown="doseDrag.onPointerDown"
          @pointermove="doseDrag.onPointerMove"
          @pointerup="doseDrag.onPointerUp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.bean"></svg>
          <span class="num">{{ recipe.targetDoseWeight.toFixed(1) }}</span><span class="unit">g</span>
        </button>
        <!-- Roast-date chip: describes the bag, so it sits under the bean's
             own orb rather than as a page-wide header. -->
        <button class="roast-chip" @click="showRoastPicker = true">
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.drop"></svg>{{ roastLabel }}
        </button>
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('espresso.grinder') }}</span>
        <!-- With only one grinder configured it's implicit (see useCore.js's
             singleGrinder) — plain text, nothing to switch TO. -->
        <button v-if="!singleGrinder" class="dial-id" :aria-label="t('espresso.changeGrinder')" @click="pickGrinder">
          <span class="dial-id-name">{{ recipe.grinderModel }}</span>
          <span class="dial-id-sub">{{ currentGrinderBurrs }}</span>
        </button>
        <div v-else class="dial-id plain">
          <span class="dial-id-name">{{ recipe.grinderModel }}</span>
          <span class="dial-id-sub">{{ currentGrinderBurrs }}</span>
        </div>
        <button
          class="dial"
          :class="{ dragging: grindDrag.dragging.value }"
          @click="onGrindClick"
          @pointerdown="grindDrag.onPointerDown"
          @pointermove="grindDrag.onPointerMove"
          @pointerup="grindDrag.onPointerUp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.gear"></svg>
          <span class="num">{{ recipe.grinderSetting }}</span>
          <!-- Grind size is unitless, but an empty unit line keeps the icon/num/
               unit stack the same height as the dose orb (which has "g"), so both
               numbers centre at the same vertical position. -->
          <span class="unit" aria-hidden="true">&nbsp;</span>
        </button>
      </div>

      <div class="dial-group">
        <span class="dial-label">{{ t('espresso.profile') }}</span>
        <button class="dial-id" :aria-label="t('espresso.changeProfile')" @click="showProfilePicker = true">
          <span class="dial-id-name">{{ recipe.profileTitle }}</span>
        </button>
        <div class="dial dial-duo">
          <div class="duo">
            <button
              :class="{ dragging: yieldDrag.dragging.value, faded: !recipe.stopAtWeight }"
              @click="onYieldClick"
              @pointerdown="yieldDrag.onPointerDown"
              @pointermove="yieldDrag.onPointerMove"
              @pointerup="yieldDrag.onPointerUp"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.cup"></svg><br />
              <span class="num">{{ recipe.targetYield.toFixed(1) }}</span><br /><span class="unit">g</span>
            </button>
            <button
              :class="{ dragging: tempDrag.dragging.value }"
              @click="onTempClick"
              @pointerdown="tempDrag.onPointerDown"
              @pointermove="tempDrag.onPointerMove"
              @pointerup="tempDrag.onPointerUp"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.thermo"></svg><br />
              <span class="num">{{ recipe.groupTemp }}</span><br /><span class="unit">°C</span>
            </button>
          </div>
          <!-- Stop-at-weight toggle, text-free: the dimmed yield grams are the
               only "off" cue now (see .faded above). -->
          <button
            class="switch stop-toggle"
            :class="{ on: recipe.stopAtWeight }"
            role="switch"
            :aria-checked="recipe.stopAtWeight"
            :aria-label="t('espresso.stopAtWeight')"
            @click="toggleStopAtWeight"
          ></button>
        </div>
      </div>
    </div>

    <div v-if="hasRecipe" class="recipe-rate-row">
      <StarRating v-if="recipe.rating > 0" :model-value="recipe.rating" readonly :size="20" />
      <button class="rate-recipe-btn" @click="openRateRecipe">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" /></svg>
        {{ t('rating.rate') }}
      </button>
    </div>

    <div v-if="hasRecipe" class="prep-bottom prep-bottom-3">
      <button class="btn" @click="showRecipePicker = true">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.list"></svg>{{ t('espresso.recipes') }}
      </button>
      <button v-if="recipe.profile" class="btn" @click="showProfileEditor = true">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.profile"></svg>{{ t('espresso.editProfile') }}
      </button>
      <button class="btn" @click="loadHistoryForCurrentRecipe">
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS.history"></svg>{{ t('espresso.history') }}
      </button>
    </div>

    <RecipePicker v-if="showRecipePicker" @back="showRecipePicker = false" />
    <RecipePicker
      v-if="showRecipeCreator"
      start-step="bean"
      @back="showRecipeCreator = false"
      @created="showRecipeCreator = false"
    />
    <BeanChooser v-if="showBeanChooser" :show-step="false" @pick="onBeanPicked" @back="showBeanChooser = false" />
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
