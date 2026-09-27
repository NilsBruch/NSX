<script setup>
/**
 * The coffee page's graph layout (skinSettings.coffeeGraph): recipe cards on
 * the left; the selected one's shot stepper, graph and dose/grind/output/temp
 * card on the right (Rate and Edit profile live in a card's hold menu — see
 * openCardMenu). Selecting a card here IS loading the recipe onto the machine
 * — same as RecipeOverlay.vue's cards — but the push is debounced (see selectRecipe/schedulePushForRecipe in
 * useRecipe.js) so flicking through several cards to compare their graphs
 * pushes once, not once per tap.
 *
 * The graph's shot stepper deliberately does NOT reuse useLiveShot.js's
 * historyShots/historyIndex/phase — those exist to drive the globally-mounted
 * full-screen LiveShotOverlay (loadHistoryForCurrentRecipe sets phase to
 * 'history', which OPENS that overlay), and are also written by the Diary's
 * drill-down and the post-shot review. Sharing them here would mean a Diary
 * click repoints this page, a finished shot resets its index, and a stepper
 * tap here kills the review's auto-close timer. This component owns its own
 * small, disposable slice of that same shape instead.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { recipe, refreshRecipes, selectRecipe, schedulePushForRecipe, togglePinRecipe, deleteRecipe, currentRecipeShots, loadRecipeShots, recipeShotsKey } from '../composables/useRecipe.js';
import { openHistoryAt } from '../composables/useLiveShot.js';
import { useRecipeDials } from '../composables/useRecipeDials.js';
import { shots, loadShots, formatDateParts, recipeCoffeeName, recipeRoasterName } from '../composables/useCore.js';
import { skinSettings } from '../composables/useSettings.js';
import { openChooser, openConfirm } from '../composables/useModals.js';
import { useLongPress } from '../composables/useLongPress.js';
import { useRecipeList } from '../composables/useRecipeList.js';
import { formatClock } from '../utils/clock.js';
import RecipeCard from './RecipeCard.vue';
import RecipeSettingsCard from './RecipeSettingsCard.vue';
import ShotStripChart from './ShotStripChart.vue';
import { dispTemp, tempUnitLabel } from '../composables/useUnits.js';

// pick-bean/pick-grinder/pick-profile: same three EspressoView already binds
// for RecipeOverlay's identity bubbles (showBeanChooser/pickGrinder/
// showProfilePicker) — reused here for the card long-press menu's Change
// bean/grinder/profile, since this layout drops the identity bubbles
// entirely (the card list is already how you switch bean+profile combos).
const emit = defineEmits(['edit-profile', 'open-roast', 'pick-bean', 'pick-grinder', 'pick-profile']);
const { t } = useI18n();
const { NSXCore } = window;
const { rateRecipe } = useRecipeDials();

// Same reason RecipeOverlay.vue's onMounted has: shots are what date/sort a
// recipe, and the recipe library itself may not have been fetched yet if the
// Diary was never opened this session.
onMounted(() => {
  refreshRecipes();
  if (!shots.value.length) loadShots(200).catch(() => { /* unsorted list is still usable */ });
  // The loaded recipe's own history may never have been fetched — the
  // identity watcher in useRecipe.js only fires on a CHANGE, and arriving on
  // this page with the boot-time recipe still loaded isn't one.
  if (recipeShotsKey.value !== NSXCore.getWorkflowKey(recipe)) loadRecipeShots();
});

// No sort/search UI on this screen — always sorted by use (useRecipeList's
// own default sortMode), and with no way to set a query, listedRecipes and
// its old query-filtered visibleRecipes are the same list; only the former
// is needed now.
const { isCurrent, listedRecipes } = useRecipeList();

async function pick(entry) {
  if (isCurrent(entry)) return;
  await selectRecipe(entry, { push: false });
  schedulePushForRecipe(entry);
}

/**
 * Same press-and-hold menu as RecipeOverlay.vue's cards, minus Load: a plain
 * tap already loads the recipe here (see pick() above — RecipeOverlay's own
 * tap only browses, it needs the menu's Load to actually switch), so a
 * second way to do the same thing from the hold menu would be redundant.
 * Pin/Delete are identical either way.
 *
 * Change bean/grinder/profile live here (not on the page itself) because
 * this layout has no identity bubbles to tap — the card list already IS how
 * you switch between bean+profile combinations, so this is the one door left
 * for changing just ONE part of an existing recipe in place. Rate and Edit
 * profile joined them here for the same reason: this layout is short on
 * vertical space (list, graph, settings card), and both are per-recipe
 * actions, so the card they belong to is a better home than a page-wide row
 * under the graph.
 *
 * Every one of those acts on the loaded `recipe` singleton, so a menu opened
 * from a card that ISN'T already loaded loads it first — otherwise the action
 * would land on a different recipe than the one just long-pressed.
 */
async function openCardMenu(entry) {
  const choice = await openChooser({
    title: `${recipeRoasterName(entry)} ${recipeCoffeeName(entry)}`,
    options: [
      ['pin', entry.pinned ? t('diary.unpin') : t('diary.pin')],
      ['rate', t('rating.rate')],
      // Only for a recipe that actually references a profile — same id-then-title
      // rule useRecipe's hasProfile applies, but read off THIS entry rather than
      // the loaded one, since the menu can be opened on any card.
      ...(entryHasProfile(entry) ? [['editProfile', t('espresso.editProfile')]] : []),
      ['bean', t('espresso.changeBean')],
      ['grinder', t('espresso.changeGrinder')],
      ['profile', t('espresso.changeProfile')],
      ['delete', t('common.delete')],
    ],
  });
  if (choice === 'pin') {
    await togglePinRecipe(entry);
  } else if (choice === 'rate' || choice === 'editProfile' || choice === 'bean' || choice === 'grinder' || choice === 'profile') {
    if (!isCurrent(entry)) await pick(entry);
    if (choice === 'rate') await rateRecipe();
    else if (choice === 'editProfile') emit('edit-profile');
    else if (choice === 'bean') emit('pick-bean');
    else if (choice === 'grinder') emit('pick-grinder');
    else emit('pick-profile');
  } else if (choice === 'delete') {
    const ok = await openConfirm({
      title: t('diary.deleteRecipeConfirm'),
      message: `${recipeRoasterName(entry)} – ${recipeCoffeeName(entry)}`,
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok) await deleteRecipe(entry.id);
  }
}

// See the Edit-profile entry in openCardMenu: the loaded recipe's own version
// of this is useRecipe's `hasProfile`.
const entryHasProfile = (entry) =>
  Boolean(entry.selectedProfileId) || (Boolean(entry.profileTitle) && entry.profileTitle !== '—');

const cardPress = useLongPress({ tap: pick, hold: openCardMenu });

// ── This recipe's shots, newest-first — independent of useLiveShot.js ──
// The expert plot brings its own legend (toggles, not a caption), so the
// .glabel below is hidden when it's on — same rule as LiveShotOverlay's.
const expertGraph = computed(() => skinSettings.graphMode === 'expert');

// The recipe's FULL history (gateway-queried, see useRecipe.js's
// currentRecipeShots) — not the newest-200 reference list, which made a
// recipe that hadn't been brewed in a while look like it never had been.
const graphShots = currentRecipeShots;
const graphIndex = ref(0); // 0 = newest
const graphShot = ref(null); // full detail (incl. measurements), fetched below
let reqId = 0; // guards against a slower, older fetch landing after a newer one

watch([graphIndex, graphShots], async ([idx, list]) => {
  const target = list[idx];
  if (!target) { graphShot.value = null; return; }
  const my = ++reqId;
  try {
    const full = await NSXCore.getShotDetails(target.id);
    if (my !== reqId) return; // a newer tap/step already moved on
    graphShot.value = full;
  } catch (err) {
    if (my !== reqId) return;
    console.warn('[Nova] Failed to load shot details:', err?.message || err);
    graphShot.value = null;
  }
}, { immediate: true });

// New shot (or a recipe switch) -> jump to the newest; a deletion elsewhere
// that shrinks the list -> clamp back onto the new last index.
watch(graphShots, (list, prev) => {
  if (list[0]?.id !== prev?.[0]?.id) graphIndex.value = 0;
  else if (graphIndex.value >= list.length) graphIndex.value = Math.max(0, list.length - 1);
});

const canOlder = computed(() => graphIndex.value < graphShots.value.length - 1);
const canNewer = computed(() => graphIndex.value > 0);
function olderShot() { if (canOlder.value) graphIndex.value += 1; }
function newerShot() { if (canNewer.value) graphIndex.value -= 1; }

// Bounces the WHOLE stepper pill (not just the label button) on a press of
// the label — :active on the outer .date-nav would do this for free in a
// browser new enough for it to bubble the way :has() does, but this tablet's
// WebView (~Chromium 96) is exactly what already rules :has() out elsewhere
// in this file, so the press state is tracked explicitly instead and bound
// as a class on the parent. Only the label's own presses toggle it — the
// ‹ › stepper buttons are untouched.
const datePressed = ref(false);

// Tapping the label (not the ‹ › steppers) jumps to the full-screen shot
// review at whatever's currently shown — openHistoryAt takes an explicit
// shot list rather than reading useLiveShot's own historyShots, so this
// deliberately hands it graphShots/graphIndex's current shot without
// touching this component's own (separate, see the file header) state.
function openHistoricalReview() {
  const shot = graphShots.value[graphIndex.value];
  if (!shot) return;
  openHistoryAt(graphShots.value, shot);
}

// Kept as one computed (rather than re-normalizing per use) since both
// graphSeries below AND the scrub temperature lookup further down need it.
const graphNormalized = computed(() => (graphShot.value ? NSXCore.normalizeShotData(graphShot.value) : null));

// Same shape ShotStripChart expects from the live series (useLiveShot.js) —
// scaleRate is normalizeShotData's name for weight-flow.
const graphSeries = computed(() => {
  const s = graphNormalized.value;
  if (!s) return { elapsed: [], pressure: [], targetPressure: [], flow: [], targetFlow: [], weightFlow: [], temperature: [] };
  // temperature/targetTemperature feed the expert plot's right-hand scale; the
  // normal one never draws them (see ShotStripChart).
  return {
    elapsed: s.elapsed, pressure: s.pressure, targetPressure: s.targetPressure,
    flow: s.flow, targetFlow: s.targetFlow, weightFlow: s.scaleRate,
    temperature: s.temperature, targetTemperature: s.targetTemperature,
  };
});

// Hold-to-scrub readout — same pattern as LiveShotOverlay.vue's own history
// screen: ShotStripChart emits the sample under the finger while held, null
// on release.
const scrub = ref(null);
watch(graphIndex, () => { scrub.value = null; });
const fmt = (v, dec = 1) => (Number.isFinite(v) ? v.toFixed(dec) : '—');

// ShotStripChart never plots or reports temperature — deliberately: "the
// strip chart is about extraction dynamics on the shared 0-12 scale" (its own
// header comment) — so its scrub payload has no temp field. Looked up here
// instead, against the same normalized data the chart renders, by nearest
// elapsed sample (the same technique ShotStripChart's own scrubAt uses
// internally, just against the temperature series instead of pressure/flow).
const scrubTemp = computed(() => {
  const s = graphNormalized.value;
  if (!scrub.value || !s?.elapsed?.length || !s.temperature?.length) return null;
  let best = 0, bestDelta = Infinity;
  for (let i = 0; i < s.elapsed.length; i++) {
    const d = Math.abs(s.elapsed[i] - scrub.value.elapsed);
    if (d < bestDelta) { bestDelta = d; best = i; }
  }
  return s.temperature[best] ?? null;
});

const stepperLabel = computed(() => {
  const listed = graphShots.value[graphIndex.value];
  if (!listed?.timestamp) return '—';
  const d = new Date(listed.timestamp);
  const { weekday, day, month } = formatDateParts(listed.timestamp);
  const time = formatClock(d);
  const secs = graphShot.value ? NSXCore.getShotDurationSeconds(graphShot.value) : null;
  const duration = secs != null ? `${secs.toFixed(1)}s` : '—.-s';
  return `${weekday} ${day}.${month}. | ${time} | ${duration}`;
});
const stepperDetail = computed(() => {
  if (!graphShot.value) return '';
  const parts = [];

  // Grind + brew temp as RECORDED WITH the shot — mapShotToWorkflow (also
  // what the Diary/NSX use) reads grinderSetting straight from workflow.context
  // and resolves the temp from the shot's own embedded profile, so this is the
  // grind/temp that shot actually ran at, not the recipe's current dial value.
  const wf = NSXCore.mapShotToWorkflow(graphShot.value);
  // Gear glyph so a bare number reads as the grind setting rather than just
  // another unlabeled figure next to dose/yield/temp — same convention NSX's
  // own shot meta line uses.
  if (wf.grinderSetting && wf.grinderSetting !== '—') parts.push(`⚙ ${wf.grinderSetting}`);

  const dose = NSXCore.resolveActualDose(graphShot.value);
  const yieldInfo = NSXCore.resolveActualYield(graphShot.value);
  if (dose != null || yieldInfo?.value != null) {
    const doseStr = dose != null ? `${dose.toFixed(1)}g` : '—';
    const yieldStr = yieldInfo?.value != null ? `${yieldInfo.estimated ? '~' : ''}${yieldInfo.value.toFixed(1)}${yieldInfo.unit}` : '—';
    // calcRatio already returns the full "1:x.x" string, not just the number.
    const ratio = (dose && yieldInfo?.value) ? ` (${NSXCore.calcRatio(dose, yieldInfo.value)})` : '';
    parts.push(`${doseStr} → ${yieldStr}${ratio}`);
  }

  if (wf.profileTemp && wf.profileTemp !== '—') parts.push(wf.profileTemp);

  return parts.join(' · ');
});
</script>

<template>
  <div class="espresso-browse">
    <!-- No sort/search row above the list any more (always sorted by use) —
         the list itself runs the full column height flush to the page's
         bottom edge (see .rp-list's fade mask) — the right column reserves
         its own space for the stepper above and the settings card below the
         graph, so the list visibly reaches further down than the graph does,
         as if more recipes are queued up just out of view. -->
    <div class="browse-list">
      <div class="rp-list">
        <div class="rp-list-scroll">
          <RecipeCard
            v-for="entry in listedRecipes"
            :key="entry.id"
            :entry="entry"
            :current="isCurrent(entry)"
            @pointerdown="cardPress.down($event, entry)"
            @pointermove="cardPress.move"
            @pointerup="cardPress.up(entry)"
            @pointercancel="cardPress.cancel"
            @pointerleave="cardPress.cancel"
          />
          <div v-if="!listedRecipes.length" class="rp-empty">{{ t('recipePicker.noRecipesYet') }}</div>
        </div>
      </div>
    </div>

    <!-- The graph column carries the page title (freed up by EspressoView
         hiding its own in graph mode — see there), the stepper, the graph,
         then the settings card — all scoped to this column's
         width rather than the full page, which is what leaves the list on
         the left free to run past it. -->
    <div class="browse-graph-col">
      <div class="page-title browse-graph-title">{{ t('espresso.pageTitle') }}</div>

      <!-- The shot stepper, centred under the title — moved up from the
           bottom row now that the settings card (below the graph) took its
           old spot. A fixed-width pill (see .date-nav.browse-nav
           .date's own comment), so centring it here never jitters shot to shot. -->
      <div class="browse-nav-row">
        <div class="date-nav browse-nav" :class="{ 'is-pressed': datePressed }">
          <button :disabled="!canOlder" :aria-label="t('espresso.olderShot')" @click="olderShot">‹</button>
          <!-- The ‹ › buttons step through shots in place; tapping the label
               itself opens the full-screen review at whichever one is shown. -->
          <button
            class="date"
            :disabled="!graphShots.length"
            :aria-label="t('liveShot.historyTitle')"
            @click="openHistoricalReview"
            @pointerdown="datePressed = true"
            @pointerup="datePressed = false"
            @pointercancel="datePressed = false"
            @pointerleave="datePressed = false"
          >
            {{ stepperLabel }}
            <small v-if="stepperDetail" class="date-time">{{ stepperDetail }}</small>
          </button>
          <button :disabled="!canNewer" :aria-label="t('espresso.newerShot')" @click="newerShot">›</button>
        </div>
      </div>

      <div class="shot-graph">
        <ShotStripChart :series="graphSeries" mode="static" :show-targets="skinSettings.showTargets" :expert="expertGraph" @scrub="scrub = $event" />
        <!-- Hold a finger on the graph to fill each label with that point's
             value — same interaction as LiveShotOverlay's own history screen.
             Temperature isn't part of the chart itself (see scrubTemp's own
             note), but reads from the same scrubbed instant. -->
        <!-- The value REPLACES the label while scrubbing (the swatch says
             which series it is) — label plus number made the row too long. -->
        <div v-if="!expertGraph" class="glabel glabel-inset">
          <i><span class="sw" style="background:#5fb8a5"></span><b v-if="scrub">{{ fmt(scrub.pressure) }}<small>bar</small></b><template v-else>{{ t('liveShot.mPressure') }}</template></i>
          <i><span class="sw" style="background:#7fa8c9"></span><b v-if="scrub">{{ fmt(scrub.flow) }}<small>ml/s</small></b><template v-else>{{ t('liveShot.mFlow') }}</template></i>
          <i><span class="sw" style="background:#ad7648"></span><b v-if="scrub">{{ fmt(scrub.weightFlow) }}<small>g/s</small></b><template v-else>{{ t('liveShot.mWflow') }}</template></i>
          <i><span class="sw" style="background:#e8846f"></span><b v-if="scrub">{{ dispTemp(scrubTemp) }}<small>{{ tempUnitLabel }}</small></b><template v-else>{{ t('liveShot.mTemp') }}</template></i>
        </div>
        <div v-if="!graphShots.length" class="browse-graph-empty">{{ t('liveShot.noShotsYet') }}</div>
      </div>

      <!-- The recipe's dose/grind/output/temp, inlined here instead of behind
           an Edit Recipe button — see useRecipeDials.js for the shared
           tap/drag wiring RecipeBody.vue's own big dials use identically. -->
      <RecipeSettingsCard @open-roast="emit('open-roast')" />
    </div>
  </div>
</template>
