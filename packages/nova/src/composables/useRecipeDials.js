/**
 * Recipe dial editing — dose / grind size / yield / temperature, each
 * tap-to-open-a-number-pad and press-and-drag-to-nudge (see useDragDial.js),
 * plus the stop-at-weight toggle and the Rate action. Shared by
 * RecipeBody.vue (the classic coffee page) and RecipeSettingsCard.vue (the
 * graph layout's compact card) so this wiring exists in exactly one place no
 * matter which layout is on screen — see either component's own header.
 *
 * A factory, not a module singleton (same convention as useRecipeList.js):
 * each caller gets its own useI18n() binding, and there is no per-caller
 * state to share — every value here reads/writes the same recipe/pushRecipe
 * module singletons regardless of who calls this.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders } from './useCore.js';
import { recipe, pushRecipe, setRecipeRating } from './useRecipe.js';
import { openNumberPad, openRating } from './useModals.js';
import { useDragDial, DIAL_PX_PER_STEP } from './useDragDial.js';
import { dispTemp, toCelsius, tempRange, tempUnitLabel } from './useUnits.js';

export function useRecipeDials() {
  const { t } = useI18n();

  async function editDose() {
    const v = await openNumberPad({ title: t('espresso.dose'), unit: 'g', value: recipe.targetDoseWeight.toFixed(1) });
    if (v == null) return;
    recipe.targetDoseWeight = parseFloat(v);
    await pushRecipe();
  }
  async function editGrind() {
    // multiPoint: a grind setting is a LABEL on the grinder's scale, not a
    // measurement — some read "1.2.4" (ring.number.click), which the one-point
    // pad could not type at all. The gateway stores the field as a string all
    // the way through (core's mapping/workflow domains never parse it), so
    // whatever the scale says can be recorded as it reads.
    const v = await openNumberPad({ title: t('espresso.grindSize'), value: recipe.grinderSetting, multiPoint: true });
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
    const v = await openNumberPad({ title: t('espresso.stopAtTemp'), unit: tempUnitLabel.value, value: String(dispTemp(recipe.groupTemp)) });
    if (v == null) return;
    // Back to Celsius immediately: the recipe is pushed to the machine, which
    // only ever speaks Celsius (see useUnits.js).
    recipe.groupTemp = toCelsius(parseFloat(v));
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
  /**
   * A setting the dial CAN'T move: a dotted scale like "1.2.4", or anything
   * else that isn't one plain number (including the "—" of a recipe with no
   * grind recorded yet).
   *
   * Dragging one of those would be destructive, not just useless —
   * parseFloat("1.2.4") is 1.2, so a single accidental pull would silently
   * rewrite the setting to a DIFFERENT, valid-looking one. There is no honest
   * step to apply either: only the grinder itself knows how many clicks its
   * last part has before it carries. Tapping still opens the pad, which is
   * where such a value gets typed.
   */
  const grindIsDialable = computed(() => Number.isFinite(Number(String(recipe.grinderSetting ?? '').trim())));

  // Grind: same feel, but the step is the grinder's own small step (a 0.1-step
  // Niche needs the same finger travel per click as a 1-step grinder).
  const rawGrindDrag = useDragDial({
    get: () => parseFloat(recipe.grinderSetting) || 0,
    set: (v) => { recipe.grinderSetting = String(Math.round(v * 100) / 100); },
    onCommit: () => pushRecipe(),
    min: 0, max: 100,
    step: () => grindStep.value,
    pxPerUnit: () => DIAL_PX_PER_STEP / grindStep.value,
  });
  // Swallowing pointerdown is what disables the drag: with no drag started,
  // the move/up handlers do nothing and `moved` stays false, so guardClick
  // still lets the tap through to the number pad.
  const grindDrag = {
    ...rawGrindDrag,
    onPointerDown: (evt) => { if (grindIsDialable.value) rawGrindDrag.onPointerDown(evt); },
  };
  const onGrindClick = grindDrag.guardClick(editGrind);

  const yieldDrag = useDragDial({
    get: () => recipe.targetYield,
    set: (v) => { recipe.targetYield = v; },
    onCommit: () => pushRecipe(),
    min: 10, max: 70, step: 0.1, pxPerUnit: DIAL_PX_PER_STEP / 0.1,
  });
  const onYieldClick = yieldDrag.guardClick(editYield);

  // Display units while dragging, Celsius on release — the number under the
  // finger and the value stored have to be the same temperature.
  const tempDrag = useDragDial({
    get: () => dispTemp(recipe.groupTemp),
    set: (v) => { recipe.groupTemp = toCelsius(v); },
    onCommit: () => pushRecipe(),
    ...tempRange(80, 100), pxPerUnit: DIAL_PX_PER_STEP / 1,
  });
  const onTempClick = tempDrag.guardClick(editTemp);

  async function toggleStopAtWeight() {
    recipe.stopAtWeight = !recipe.stopAtWeight;
    await pushRecipe();
  }

  async function rateRecipe() {
    const v = await openRating({ title: t('rating.title'), value: recipe.rating });
    if (v !== null) await setRecipeRating(v);
  }

  return {
    editDose, editGrind, editYield, editTemp,
    doseDrag, grindDrag, yieldDrag, tempDrag,
    onDoseClick, onGrindClick, onYieldClick, onTempClick,
    grindStep, toggleStopAtWeight, rateRecipe,
  };
}
