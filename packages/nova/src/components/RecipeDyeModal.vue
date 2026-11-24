<script setup>
/**
 * The recipe's DYE settings — the shot DYE page (ShotDyePage.vue), rendered
 * for a recipe instead of a shot.
 *
 * Deliberately the SAME four sections in the same order, with the same tiles
 * in the same places: a hand that has learnt where the grind or the drinker
 * lives on a shot finds it here without re-reading the screen. The two pages
 * ask one question at different times — what IS this coffee (here) versus
 * what WAS that shot (there).
 *
 * It is also where the recipe is EDITED: every tile the recipe itself holds
 * opens its editor. Dose, grind, target yield (with its ratio) and
 * temperature use the coffee page's own number pads (useRecipeDials.js);
 * bean, bag, grinder and profile ask EspressoView for the pickers it already
 * owns (emitted pick-bean / open-roast / pick-grinder / pick-profile, passed
 * up through RecipeSettingsCard / RecipeBody) — so there is still only ONE
 * implementation of each change, not a second one kept in step here. Basket,
 * equipment, RPM, barista, drinker and beverage are the DYE fields proper and
 * are set right here. Every setter pushes on its own: no save button.
 *
 * What stays greyed (.dye-off) is what the recipe cannot answer: the bean's
 * own record (origin, process, variety, notes — edited in the Diary's bean
 * editor) and everything only a pulled shot has (yield, time, TDS, EY, the
 * analysis strip). RPM greys on a fixed-speed grinder.
 *
 * The shot's enjoyment and its note have no counterpart on a recipe — there
 * is no cup to score and no verdict to write — so both are shown greyed in
 * the slots the shot page puts them in, rather than dropped or filled with a
 * substitute. Neither is the bean's tasting notes, which are the roaster's
 * and live up in the Beans section.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  recipe, roastAge, setRecipeDye, dyeNamesUsed, beanForRecipe,
} from '../composables/useRecipe.js';
import { baskets, equipment, grinders, formatGrinderLabel, formatShortDate, recipeRoasterName, recipeCoffeeName, recipeProfileTitle } from '../composables/useCore.js';
import { openTextField, openChooser, openNumberPad } from '../composables/useModals.js';
import { useRecipeKit, recipeBasketName, recipeEquipmentNames } from '../composables/useRecipeKit.js';
import { useRecipeDials } from '../composables/useRecipeDials.js';
import { dispTemp, tempUnitLabel } from '../composables/useUnits.js';
import { reportRuntimeError } from '../composables/useErrorReporting.js';
// The same four section icons the shot page uses — the mirror is the point.
import { PaperBag, Coffee, LensConcave, Users } from '@lucide/vue';

const emit = defineEmits(['close', 'pick-bean', 'pick-grinder', 'pick-profile', 'open-roast']);
const { t } = useI18n();
const { NSXCore } = window;

const dye = computed(() => recipe.dye ?? {});
const dash = (v) => (v == null || v === '' || v === '—' ? '—' : String(v));

// The DYE2 store has no push channel, so the library is re-read each time this
// opens — a basket added on another device is otherwise missing from the picker.
onMounted(async () => {
  try {
    await NSXCore.loadEquipmentLibrary();
  } catch (err) {
    // The people fields still work without it; only the two pickers go empty.
    reportRuntimeError('equipment library', err);
  }
});

/* ── Beans (read-only) ──────────────────────────────────────────────────── */

const bean = computed(() => beanForRecipe(recipe));
const beanOrigin = computed(() =>
  [bean.value?.country, bean.value?.region].filter(Boolean).join(' · ') || null);
/**
 * The bag's AGE, not its date: "3 weeks", not "12 September 2026 · 3 weeks",
 * which was wider than the tile it sits in. Age is also the thing you act on
 * — nobody decides anything from the calendar date itself.
 *
 * Core's getBatchAge coarsens as it goes (whole days under a week, then whole
 * weeks, months, years), so the string stays short however old the bag is. It
 * answers "—" for a missing, unparseable or future date; the short date is a
 * better thing to show than a dash in that case, and it fits.
 */
const roastLabel = computed(() => {
  if (!recipe.roastDate) return null;
  const age = roastAge.value;
  return age && age !== '—' ? age : formatShortDate(recipe.roastDate);
});

/* ── Extraction (read-only) ─────────────────────────────────────────────── */

// The one extraction figure a recipe really has: the ratio between its own
// two targets. Everything else in that section waits for a shot.
const targetRatio = computed(() => {
  const d = recipe.targetDoseWeight;
  const y = recipe.targetYield;
  return d > 0 && y > 0 ? NSXCore.calcRatio(d, y) : null;
});

/* ── Equipment ──────────────────────────────────────────────────────────── */

// Grinder, grind, profile and temperature are shown, not set — the coffee
// page's dials and title bar own them.
const grinderLabel = computed(() => {
  const g = grinders.value.find((x) => x.id === recipe.grinderId);
  if (g) return formatGrinderLabel(g);
  return recipe.grinderModel && recipe.grinderModel !== '—' ? recipe.grinderModel : null;
});
const tempLabel = computed(() =>
  (recipe.groupTemp > 0 ? `${dispTemp(recipe.groupTemp, 1).toFixed(1)} ${tempUnitLabel.value}` : null));

// The pickers themselves are shared with the coffee page's kit chips — see
// useRecipeKit.js.
const { pickBasket, pickEquipment } = useRecipeKit();
// The coffee page's own number pads — the same edit, wherever it is started.
const { editDose, editGrind, editYield, editTemp } = useRecipeDials();

// Both through the library by id — a renamed row reads by its new name here.
const basketLabel = computed(() => recipeBasketName(recipe));
const equipmentLabel = computed(() => {
  const names = recipeEquipmentNames(recipe);
  return names.length ? names.join(', ') : null;
});

// Most grinders run at one speed. The field is always SHOWN — so the layout
// doesn't shift as you change grinder, and so it's clear the skin records
// this at all — but it only takes a value on a grinder whose speed adjusts
// (core's grinderHasVariableRpm, which reads the rpm steps as the flag).
// A recipe already carrying an RPM stays editable regardless, rather than
// stranding a value it holds behind a disabled control.
const canEditRpm = computed(() =>
  NSXCore.grinderIdHasVariableRpm(recipe.grinderId) || dye.value.rpm != null);

async function editRpm() {
  const v = await openNumberPad({ title: t('recipeDye.rpm'), unit: 'rpm', value: dye.value.rpm ?? '' });
  if (v != null) await setRecipeDye({ rpm: v === '' ? null : Number(v) });
}

/* ── People ─────────────────────────────────────────────────────────────── */

async function editName(field, label) {
  const v = await openTextField({
    title: label, value: dye.value[field] ?? '', suggestions: dyeNamesUsed(field),
  });
  if (v != null) await setRecipeDye({ [field]: v });
}

async function pickBeverage() {
  const current = dye.value.finalBeverageType ?? null;
  const options = NSXCore.dyeBeverageOptions(current).map((v) => [v, t(`dye.beverage_${v}`, v)]);
  const v = await openChooser({ title: t('recipeDye.beverage'), options, current });
  if (v != null) await setRecipeDye({ finalBeverageType: v });
}


</script>

<template>
  <!-- .overlay-full as well as .dye-page: on the shot side .dye-page is a
       plain wrapper that the history slider positions, and carries no CSS of
       its own — opened from the coffee page it has to be the overlay itself.
       .overlay-full supplies exactly the fixed, flex-column frame .dye-scroll
       expects underneath it. -->
  <div class="overlay-full dye-page">
    <div class="ov-top balanced">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <span class="ov-title">{{ t('recipeDye.title') }}</span>
    </div>

    <!-- The shot page's four sections, same order, same tiles in the same
         slots — see the file comment on why the mirror is deliberate. -->
    <div class="dye-scroll">
      <div class="dye-cols">
        <!-- Roaster/bean swap the recipe's bean and the bag picks or opens a
             bag — both through EspressoView's own pickers. The rest is the
             bean's record, edited in the Diary. -->
        <section class="dye-sect">
          <header class="dye-head">
            <PaperBag aria-hidden="true" />
            <span>{{ t('dye.secBeans') }}</span>
          </header>
          <div class="dye-grid">
            <button class="dye-tile" @click="emit('pick-bean')">
              <span class="dl">{{ t('dye.roaster') }}</span>
              <span class="dv" :class="{ muted: !recipeRoasterName(recipe) }">{{ dash(recipeRoasterName(recipe)) }}</span>
            </button>
            <button class="dye-tile" @click="emit('pick-bean')">
              <span class="dl">{{ t('dye.bean') }}</span>
              <span class="dv" :class="{ muted: !recipeCoffeeName(recipe) }">{{ dash(recipeCoffeeName(recipe)) }}</span>
            </button>
            <!-- Needs a real bean to hang bags off (EspressoView's openBatchPicker). -->
            <button class="dye-tile" :disabled="!bean" @click="emit('open-roast')">
              <span class="dl">{{ t('dye.bag') }}</span>
              <span class="dv" :class="{ muted: !roastLabel }">{{ dash(roastLabel) }}</span>
            </button>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.origin') }}</span>
              <span class="dv" :class="{ muted: !beanOrigin }">{{ dash(beanOrigin) }}</span>
            </div>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.process') }}</span>
              <span class="dv" :class="{ muted: !bean?.processing }">{{ dash(bean?.processing) }}</span>
            </div>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.variety') }}</span>
              <span class="dv" :class="{ muted: !bean?.variety }">{{ dash(bean?.variety) }}</span>
            </div>
            <!-- The roaster's own notes on the bag, not a verdict on a shot.
                 Full width of this section: they run long. -->
            <div class="dye-tile static dye-span dye-off">
              <span class="dl">{{ t('dye.beanNotes') }}</span>
              <span class="dv fit" :class="{ muted: !bean?.notes }">{{ dash(bean?.notes) }}</span>
            </div>
          </div>
        </section>

        <!-- Dose, target yield and ratio are the recipe's own targets and edit
             here (ratio opens the yield pad, which carries the linked ratio);
             the rest wait for a shot. -->
        <section class="dye-sect">
          <header class="dye-head">
            <Coffee aria-hidden="true" />
            <span>{{ t('dye.secExtraction') }}</span>
          </header>
          <div class="dye-grid">
            <button class="dye-tile" @click="editDose">
              <span class="dl">{{ t('dye.dose') }}</span>
              <span class="dv" :class="{ muted: !(recipe.targetDoseWeight > 0) }">
                {{ recipe.targetDoseWeight > 0 ? `${recipe.targetDoseWeight.toFixed(1)} g` : '—' }}
              </span>
            </button>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.yield') }}</span>
              <span class="dv muted">—</span>
            </div>
            <button class="dye-tile" @click="editYield">
              <span class="dl">{{ t('dye.targetYield') }}</span>
              <span class="dv" :class="{ muted: !(recipe.targetYield > 0) }">
                {{ recipe.targetYield > 0 ? `${recipe.targetYield.toFixed(0)} g` : '—' }}
              </span>
            </button>
            <button class="dye-tile" @click="editYield">
              <span class="dl">{{ t('dye.ratio') }}</span>
              <span class="dv" :class="{ muted: !targetRatio }">{{ dash(targetRatio) }}</span>
            </button>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.time') }}</span>
              <span class="dv muted">—</span>
            </div>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.stopReason') }}</span>
              <span class="dv muted">—</span>
            </div>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.tds') }}</span>
              <span class="dv muted">—</span>
            </div>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.ey') }}</span>
              <span class="dv muted">—</span>
            </div>
          </div>
        </section>

        <!-- The slot the shot page's analysis strip takes, read-only for the
             same reason: these are measured off a recording. -->
        <div class="dye-analysis dye-off">
          <div class="dye-tile static">
            <span class="dl">{{ t('dye.totalWater') }}</span><span class="dv muted">—</span>
          </div>
          <div class="dye-tile static">
            <span class="dl">{{ t('dye.avgPressure') }}</span><span class="dv muted">—</span>
          </div>
          <div class="dye-tile static">
            <span class="dl">{{ t('dye.avgFlow') }}</span><span class="dv muted">—</span>
          </div>
        </div>

        <!-- All editable: grinder and profile through EspressoView's pickers,
             grind and temperature through the coffee page's number pads,
             basket/kit/RPM right here. -->
        <section class="dye-sect">
          <header class="dye-head">
            <LensConcave aria-hidden="true" />
            <span>{{ t('dye.secEquipment') }}</span>
          </header>
          <div class="dye-grid">
            <button class="dye-tile" :disabled="!grinders.length" @click="emit('pick-grinder')">
              <span class="dl">{{ t('dye.grinder') }}</span>
              <span class="dv" :class="{ muted: !grinderLabel }">{{ dash(grinderLabel) }}</span>
            </button>
            <!-- Greys to the same 0.55 as every other tile you can't act on
                 here (see .dye-off in app.css); :disabled rather than the
                 class so it also drops out of the focus order. -->
            <button class="dye-tile" :disabled="!canEditRpm" @click="editRpm">
              <span class="dl">{{ t('recipeDye.rpm') }}</span>
              <span class="dv" :class="{ muted: dye.rpm == null }">{{ dash(dye.rpm) }}</span>
            </button>
            <button class="dye-tile" @click="editGrind">
              <span class="dl">{{ t('dye.grind') }}</span>
              <span class="dv" :class="{ muted: recipe.grinderSetting === '—' }">{{ dash(recipe.grinderSetting) }}</span>
            </button>
            <button class="dye-tile" :disabled="!baskets.length" @click="pickBasket">
              <span class="dl">{{ t('recipeDye.basket') }}</span>
              <span class="dv" :class="{ muted: !basketLabel }">{{ dash(basketLabel) }}</span>
            </button>
            <!-- Two columns: it holds a LIST now ("Lunar, WDT tool, dosing
                 ring"), which a half tile ellipsised down to the first name. -->
            <button class="dye-tile dye-span2" :disabled="!equipment.length" @click="pickEquipment">
              <span class="dl">{{ t('recipeDye.equipment') }}</span>
              <span class="dv" :class="{ muted: !equipmentLabel }">{{ dash(equipmentLabel) }}</span>
            </button>
            <div class="dye-pair">
              <button class="dye-tile" @click="emit('pick-profile')">
                <span class="dl">{{ t('dye.profile') }}</span>
                <span class="dv fit" :class="{ muted: !recipeProfileTitle(recipe) }">{{ dash(recipeProfileTitle(recipe)) }}</span>
              </button>
              <button class="dye-tile" @click="editTemp">
                <span class="dl">{{ t('dye.temperature') }}</span>
                <span class="dv" :class="{ muted: !tempLabel }">{{ dash(tempLabel) }}</span>
              </button>
            </div>
          </div>
        </section>

        <section class="dye-sect">
          <header class="dye-head">
            <Users aria-hidden="true" />
            <span>{{ t('dye.secPeople') }}</span>
          </header>
          <div class="dye-grid">
            <button class="dye-tile" @click="editName('baristaName', t('recipeDye.barista'))">
              <span class="dl">{{ t('recipeDye.barista') }}</span>
              <span class="dv" :class="{ muted: !dye.baristaName }">{{ dash(dye.baristaName) }}</span>
            </button>
            <button class="dye-tile" @click="editName('drinkerName', t('recipeDye.drinker'))">
              <span class="dl">{{ t('recipeDye.drinker') }}</span>
              <span class="dv" :class="{ muted: !dye.drinkerName }">{{ dash(dye.drinkerName) }}</span>
            </button>
            <button class="dye-tile" @click="pickBeverage">
              <span class="dl">{{ t('recipeDye.beverage') }}</span>
              <span class="dv" :class="{ muted: !dye.finalBeverageType }">
                {{ dye.finalBeverageType ? t(`dye.beverage_${dye.finalBeverageType}`, dye.finalBeverageType) : '—' }}
              </span>
            </button>
            <!-- Enjoyment belongs to a SHOT — it scores one pull you drank,
                 which is not a thing a recipe can be. (A recipe has its own
                 rating, but that is the Rate button on the coffee page and a
                 different judgement: how the recipe goes, not how this cup
                 went.) Shown greyed rather than swapped for either of those:
                 the mirror only works if the slot holds the field the shot
                 page holds, and a different control wearing its place would
                 be read as the same thing. -->
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.enjoyment') }}</span>
              <span class="dv muted">—</span>
            </div>
            <!-- The shot's own note — how that cup tasted. A recipe has no
                 verdict on itself, so the slot is greyed rather than dropped:
                 the two pages have to hold the same fields in the same places
                 for the mirror to be worth anything. Not to be confused with
                 the bean notes up in Beans, which are the roaster's. -->
            <div class="dye-tile static dye-span2 dye-off">
              <span class="dl">{{ t('dye.notes') }}</span>
              <span class="dv muted">—</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>
