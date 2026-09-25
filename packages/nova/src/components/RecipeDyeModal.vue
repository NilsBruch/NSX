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
 * Most of it is READ-ONLY, and greys uniformly: one treatment meaning "not
 * yours to act on here", whatever the underlying reason. Those reasons do
 * differ — the bean, the dials' dose and yield, the grinder, the grind and
 * the profile are all set elsewhere in the app; yield, time, TDS and the
 * analysis strip wait on a shot that hasn't happened; RPM doesn't apply to a
 * fixed-speed grinder — but they are not a distinction anybody can read off
 * the screen, so the page does not try to draw one. The recipe's own targets
 * still show through wherever it has them (dose, target yield, their ratio);
 * only what a shot alone can answer is a dash.
 *
 * Showing the read-only tiles at all is what keeps the mirror complete,
 * without opening a second way to change them that would have to be kept in
 * step with the coffee page.
 *
 * What this page actually edits is the DYE fields proper — basket, equipment,
 * RPM, barista, drinker, beverage. Those write to the RECIPE and push, so
 * they take effect on the next shot, and only the next one: a shot
 * already pulled keeps what it recorded, and is corrected on the shot's own
 * DYE page. Every setter used here pushes on its own, so there is no save
 * button and no separate persist step.
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
import { baskets, equipment, grinders, formatGrinderLabel, formatShortDate } from '../composables/useCore.js';
import { openTextField, openChooser, openMultiChooser, openNumberPad } from '../composables/useModals.js';
import { dispTemp, tempUnitLabel } from '../composables/useUnits.js';
import { reportRuntimeError } from '../composables/useErrorReporting.js';
// The same four section icons the shot page uses — the mirror is the point.
import { PaperBag, Coffee, LensConcave, Users } from '@lucide/vue';

defineEmits(['close']);
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

/** A library pick, or "— None —" to clear the field back to nothing. */
async function pickFromLibrary({ title, rows, idField, nameField }) {
  const options = [['', t('recipeDye.none')], ...rows.map((r) => [r.id, r.name || '—'])];
  const id = await openChooser({ title, options, current: dye.value[idField] ?? '' });
  if (id == null) return;
  const row = rows.find((r) => r.id === id);
  await setRecipeDye({ [idField]: row?.id ?? null, [nameField]: row?.name ?? null });
}
const pickBasket = () => pickFromLibrary({
  title: t('recipeDye.basket'), rows: baskets.value, idField: 'basketId', nameField: 'basketName',
});
/**
 * Equipment is a LIST — a shot is pulled with a scale AND a WDT tool AND a
 * dosing ring — so this is the multi-select, and the recipe stores parallel
 * id/name arrays (core's equipmentArrays). The names are stored beside the
 * ids for the same reason a basket's is: a shot has to still read correctly
 * once a row behind it is deleted.
 */
async function pickEquipment() {
  const rows = equipment.value;
  const ids = await openMultiChooser({
    title: t('recipeDye.equipment'),
    options: rows.map((r) => [r.id, r.name || '—']),
    current: dye.value.equipmentIds ?? [],
  });
  if (ids == null) return;
  const picked = ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  await setRecipeDye({
    equipmentIds: picked.map((r) => r.id),
    equipmentNames: picked.map((r) => r.name ?? null),
  });
}

const equipmentLabel = computed(() => {
  const names = (dye.value.equipmentNames ?? []).filter(Boolean);
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
        <!-- Read-only: the bean and its bag are changed on the coffee page
             (the title bar's recipe picker), which resolves the batch record
             behind them — this page only shows what that chose. -->
        <section class="dye-sect dye-off">
          <header class="dye-head">
            <PaperBag aria-hidden="true" />
            <span>{{ t('dye.secBeans') }}</span>
          </header>
          <div class="dye-grid">
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.roaster') }}</span>
              <span class="dv" :class="{ muted: recipe.coffeeRoaster === '—' }">{{ dash(recipe.coffeeRoaster) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.bean') }}</span>
              <span class="dv" :class="{ muted: recipe.coffeeName === '—' }">{{ dash(recipe.coffeeName) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.bag') }}</span>
              <span class="dv" :class="{ muted: !roastLabel }">{{ dash(roastLabel) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.origin') }}</span>
              <span class="dv" :class="{ muted: !beanOrigin }">{{ dash(beanOrigin) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.process') }}</span>
              <span class="dv" :class="{ muted: !bean?.processing }">{{ dash(bean?.processing) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.variety') }}</span>
              <span class="dv" :class="{ muted: !bean?.variety }">{{ dash(bean?.variety) }}</span>
            </div>
            <!-- The roaster's own notes on the bag, not a verdict on a shot.
                 Full width of this section: they run long. -->
            <div class="dye-tile static dye-span">
              <span class="dl">{{ t('dye.beanNotes') }}</span>
              <span class="dv fit" :class="{ muted: !bean?.notes }">{{ dash(bean?.notes) }}</span>
            </div>
          </div>
        </section>

        <!-- Read-only: a recipe has targets, not an extraction. The tiles it
             CAN answer show through; the rest wait for a shot. -->
        <section class="dye-sect dye-off">
          <header class="dye-head">
            <Coffee aria-hidden="true" />
            <span>{{ t('dye.secExtraction') }}</span>
          </header>
          <div class="dye-grid">
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.dose') }}</span>
              <span class="dv" :class="{ muted: !(recipe.targetDoseWeight > 0) }">
                {{ recipe.targetDoseWeight > 0 ? `${recipe.targetDoseWeight.toFixed(1)} g` : '—' }}
              </span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.yield') }}</span>
              <span class="dv muted">—</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.targetYield') }}</span>
              <span class="dv" :class="{ muted: !(recipe.targetYield > 0) }">
                {{ recipe.targetYield > 0 ? `${recipe.targetYield.toFixed(0)} g` : '—' }}
              </span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.ratio') }}</span>
              <span class="dv" :class="{ muted: !targetRatio }">{{ dash(targetRatio) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.time') }}</span>
              <span class="dv muted">—</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.stopReason') }}</span>
              <span class="dv muted">—</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.tds') }}</span>
              <span class="dv muted">—</span>
            </div>
            <div class="dye-tile static">
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

        <!-- The one mixed section: the grinder, the grind and the profile are
             the coffee page's to set, so they're read-only here — while the
             basket and the kit have no other home and are edited right here. -->
        <section class="dye-sect">
          <header class="dye-head">
            <LensConcave aria-hidden="true" />
            <span>{{ t('dye.secEquipment') }}</span>
          </header>
          <div class="dye-grid">
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.grinder') }}</span>
              <span class="dv" :class="{ muted: !grinderLabel }">{{ dash(grinderLabel) }}</span>
            </div>
            <!-- Greys to the same 0.55 as every other tile you can't act on
                 here (see .dye-off in app.css); :disabled rather than the
                 class so it also drops out of the focus order. -->
            <button class="dye-tile" :disabled="!canEditRpm" @click="editRpm">
              <span class="dl">{{ t('recipeDye.rpm') }}</span>
              <span class="dv" :class="{ muted: dye.rpm == null }">{{ dash(dye.rpm) }}</span>
            </button>
            <div class="dye-tile static dye-off">
              <span class="dl">{{ t('dye.grind') }}</span>
              <span class="dv" :class="{ muted: recipe.grinderSetting === '—' }">{{ dash(recipe.grinderSetting) }}</span>
            </div>
            <button class="dye-tile" :disabled="!baskets.length" @click="pickBasket">
              <span class="dl">{{ t('recipeDye.basket') }}</span>
              <span class="dv" :class="{ muted: !dye.basketName }">{{ dash(dye.basketName) }}</span>
            </button>
            <!-- Two columns: it holds a LIST now ("Lunar, WDT tool, dosing
                 ring"), which a half tile ellipsised down to the first name. -->
            <button class="dye-tile dye-span2" :disabled="!equipment.length" @click="pickEquipment">
              <span class="dl">{{ t('recipeDye.equipment') }}</span>
              <span class="dv" :class="{ muted: !equipmentLabel }">{{ dash(equipmentLabel) }}</span>
            </button>
            <div class="dye-pair dye-off">
              <div class="dye-tile static">
                <span class="dl">{{ t('dye.profile') }}</span>
                <span class="dv fit" :class="{ muted: recipe.profileTitle === '—' }">{{ dash(recipe.profileTitle) }}</span>
              </div>
              <div class="dye-tile static">
                <span class="dl">{{ t('dye.temperature') }}</span>
                <span class="dv" :class="{ muted: !tempLabel }">{{ dash(tempLabel) }}</span>
              </div>
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
