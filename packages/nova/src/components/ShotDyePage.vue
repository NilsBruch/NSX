<script setup>
/**
 * DYE — "describe your espresso": everything a shot record holds that the
 * graph page has no room for, and the one place to correct any of it.
 *
 * It slides up from under the history view (LiveShotOverlay's `dye` page), so
 * the graph is one swipe away rather than replaced.
 *
 * Two groups, in the order a shot happens (NSX's shot review reads the same
 * way): what went IN — the recipe as it was actually brewed — and what came
 * OUT of it, ending in the note.
 *
 * Where each field lives, because the two halves save differently:
 *  - annotations (setShotAnnotations): dose, yield, TDS, EY, favourite, note.
 *    The canonical post-shot data per the REST spec; `extras` merges per field.
 *  - workflow.context (setShotContext): bean, grinder, targets, barista,
 *    drinker, beverage. The recipe AS BREWED. The spec calls the workflow
 *    immutable, but this is the same PUT NSX has always used to correct a
 *    shot's grind setting, and the gateway accepts it.
 * Read-only either way: profile, temperature, duration, ratio, stop reason —
 * facts of the pull, not opinions about it.
 *
 * Editing a field here changes THIS SHOT only. The recipe it was pulled from
 * keeps its own values (see setShotContext).
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  reviewShot, currentFullShot, grindSetting,
  setShotAnnotations, setShotContext, setActualDose, setActualYield, setGrindSetting,
} from '../composables/useLiveShot.js';
import { beans, grinders, shots, formatGrinderLabel, formatLongDate } from '../composables/useCore.js';
import { openTextField, openNumberPad, openChooser } from '../composables/useModals.js';
// Section icons from Lucide. Named imports, so only these four end up in the
// build; the style (colour, size, stroke) comes from .dye-head in app.css.
import { PaperBag, Coffee, LensConcave, Users } from '@lucide/vue';
import { shotMatchesBean } from '../composables/useDiary.js';
import BeanChooser from './BeanChooser.vue';
import BatchPicker from './BatchPicker.vue';

defineEmits(['close']);
const { t } = useI18n();
const { NSXCore, NSXApi } = window;

// The context as recorded with the shot. The full record is what an edit
// refreshes, so it wins; the list item covers the moment before it arrives.
const ctx = computed(() =>
  currentFullShot.value?.workflow?.context ?? reviewShot.value?.workflow?.context ?? {});
const ann = computed(() =>
  currentFullShot.value?.annotations ?? reviewShot.value?.annotations ?? {});

const dash = (v) => (v == null || v === '' ? '—' : String(v));
const num = (v, dec = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(dec) : null);

// ── What went in ──
const profileTitle = computed(() =>
  currentFullShot.value?.workflow?.profile?.title || ctx.value.profileTitle || null);
const groupTemp = computed(() => {
  const temp = NSXCore.resolveProfileTemp(currentFullShot.value?.workflow?.profile);
  return Number.isFinite(temp) ? `${temp.toFixed(1)} °C` : null;
});
const actualDose = computed(() => (currentFullShot.value ? NSXCore.resolveActualDose(currentFullShot.value) : null));
const grinderLabel = computed(() => {
  const g = grinders.value.find((x) => x.id === ctx.value.grinderId);
  return g ? formatGrinderLabel(g) : (ctx.value.grinderModel || null);
});

/**
 * The roast date behind the shot's `beanBatchId` — the only field here that
 * isn't in the record already, since a shot stores which bag it came from
 * rather than when that bag was roasted. Fetched per bag and cached for the
 * page's lifetime, so stepping back and forth through shots of one bag asks
 * once. A bag that has since been deleted simply stays blank.
 */
const batchCache = new Map();
const roastDate = ref(null);
watch(() => ctx.value.beanBatchId, async (id) => {
  roastDate.value = null;
  if (!id) return;
  if (!batchCache.has(id)) {
    batchCache.set(id, await NSXApi.fetchBatch(id).catch(() => null));
  }
  roastDate.value = batchCache.get(id)?.roastDate ?? null;
}, { immediate: true });

const roastLabel = computed(() => {
  if (!roastDate.value) return null;
  const age = NSXCore.getBatchAge(roastDate.value);
  return age ? `${formatLongDate(roastDate.value)} · ${age}` : formatLongDate(roastDate.value);
});

// ── What came out ──
const durationLabel = computed(() => {
  const secs = currentFullShot.value ? NSXCore.getShotDurationSeconds(currentFullShot.value) : null;
  return secs != null ? `${Math.round(secs)} s` : null;
});
const actualYield = computed(() =>
  (currentFullShot.value ? NSXCore.resolveActualYield(currentFullShot.value) : { value: null, unit: 'g', estimated: false }));
const yieldLabel = computed(() => {
  const { value, unit, estimated } = actualYield.value;
  return Number.isFinite(value) ? `${value.toFixed(1)} ${unit}${estimated ? ' *' : ''}` : null;
});
const ratioLabel = computed(() => {
  const dose = actualDose.value;
  const out = actualYield.value.value;
  return dose && out ? NSXCore.calcRatio(dose, out) : null;
});
/** Why the machine stopped, in words. An open set: a reason from a newer build
 *  than this skin knows falls back to the generic line (same as the post-shot
 *  toast, see useLiveShot's reportStopReason). */
const stopLabel = computed(() => {
  const reason = NSXCore.getShotStopReason(currentFullShot.value ?? reviewShot.value);
  if (!reason) return null;
  return t(NSXCore.isKnownStopReason(reason) ? `shotStop.${reason}` : 'shotStop.generic');
});
const favorite = computed(() => ann.value.extras?.favorite === true);
const notes = computed(() => ann.value.espressoNotes || '');

// ── Edits ──
// Names already used on other shots, so the same barista/drinker is spelled
// one way across a history — the same reason the bean editor offers its own
// past values (see openTextField's `suggestions`).
const namesUsed = (field) => [...new Set(
  shots.value.map((s) => s.workflow?.context?.[field]).filter((v) => typeof v === 'string' && v.trim()),
)];

async function editText(title, current, apply, suggestions = []) {
  const v = await openTextField({ title, value: current ?? '', suggestions });
  // '' is a real answer here — it clears the field — so only a cancel (null)
  // is ignored. The API takes null for "no value", not an empty string.
  if (v != null) await apply(v.trim() === '' ? null : v.trim());
}

async function editNumber(title, current, apply, unit = '') {
  const v = await openNumberPad({ title, unit, value: current == null ? '' : String(current) });
  if (v != null) await apply(v === '' ? null : parseFloat(v));
}

/**
 * The coffee is picked, not typed: the same two screens the recipe wizard
 * uses — a bean from the library, then the bag it came from. What a shot
 * really links to is the BAG (`beanBatchId`); the roaster and name are the
 * display strings that ride along. Typing them only ever changed the strings
 * and left the link pointing at the old bag, so the shot said one coffee and
 * belonged to another.
 *
 *   Roaster / Bean tile -> bean, then bag
 *   Bag tile            -> bag only, of the bean the shot already has (or the
 *                          bean step first, for a shot linked to none)
 *
 * The bag step's own "Back" returns to the bean step when it came from there,
 * and closes otherwise — the same way back you came in.
 */
const picking = ref(null);       // null | 'bean' | 'bag'
const pickedBean = ref(null);    // the bean whose bags the bag step lists
const bagFromBean = ref(false);  // did the bag step come from the bean step?

/** The library bean this shot is linked to: through its bag when it has one,
 *  else by roaster and name (shots from before bags existed). */
const shotBean = computed(() => {
  const shot = currentFullShot.value ?? reviewShot.value;
  if (!shot) return null;
  return beans.value.find((b) => shotMatchesBean(shot, b)) ?? null;
});

/** Origin as one line: the country, and the region when the bean has one. */
const beanOrigin = computed(() =>
  [shotBean.value?.country, shotBean.value?.region].filter(Boolean).join(' · ') || null);

function editBean() { picking.value = 'bean'; }
function editBag() {
  if (!shotBean.value) { picking.value = 'bean'; return; }
  pickedBean.value = shotBean.value;
  bagFromBean.value = false;
  picking.value = 'bag';
}
function onBeanPicked(bean) {
  pickedBean.value = bean;
  bagFromBean.value = true;
  picking.value = 'bag';
}
function onBagBack() { picking.value = bagFromBean.value ? 'bean' : null; }
async function onBagPicked(bag) {
  const bean = pickedBean.value;
  picking.value = null;
  // The bag is the link; the strings follow it so the shot reads right in
  // every list that shows them without resolving the bag.
  if (bean && bag?.id) {
    await setShotContext({ beanBatchId: bag.id, coffeeRoaster: bean.roaster ?? null, coffeeName: bean.name ?? null });
  }
}

async function editDose() {
  const v = await openNumberPad({ title: t('dye.dose'), unit: 'g', value: actualDose.value == null ? '' : String(actualDose.value) });
  if (v != null && v !== '') await setActualDose(parseFloat(v));
}

async function editYield() {
  const current = actualYield.value.value;
  const v = await openNumberPad({ title: t('dye.yield'), unit: 'g', value: Number.isFinite(current) ? current.toFixed(1) : '' });
  if (v != null && v !== '') await setActualYield(parseFloat(v));
}

async function editTargetYield() {
  await editNumber(t('dye.targetYield'), ctx.value.targetYield, (v) => setShotContext({ targetYield: v }), 'g');
}

/** The grinder the shot was pulled on. Picked from the library rather than
 *  typed: the id is what links the shot to a real grinder, and a typed model
 *  name would leave that link pointing at the old one. */
async function editGrinder() {
  const options = grinders.value.map((g) => [g.id, formatGrinderLabel(g)]);
  if (!options.length) return;
  const id = await openChooser({ title: t('dye.grinder'), options, current: ctx.value.grinderId ?? null });
  if (id == null) return;
  const g = grinders.value.find((x) => x.id === id);
  if (g) await setShotContext({ grinderId: g.id, grinderModel: g.model ?? null });
}

async function editGrind() {
  const v = await openNumberPad({ title: t('dye.grind'), value: grindSetting.value ?? '' });
  // A string, like the recipe's own grinderSetting: not every grinder's scale
  // is a number with one decimal.
  if (v != null) await setGrindSetting(String(v));
}

const editBarista = () => editText(t('dye.barista'), ctx.value.baristaName,
  (v) => setShotContext({ baristaName: v }), namesUsed('baristaName'));
const editDrinker = () => editText(t('dye.drinker'), ctx.value.drinkerName,
  (v) => setShotContext({ drinkerName: v }), namesUsed('drinkerName'));

/** Beverage type is an open set in the API, so the four Decent itself names
 *  are offered and anything already recorded (from another skin or plugin)
 *  joins the list rather than being silently replaced. */
const BEVERAGES = ['espresso', 'filter', 'lungo', 'americano'];
async function editBeverage() {
  const current = ctx.value.finalBeverageType ?? null;
  const known = current && !BEVERAGES.includes(current) ? [current, ...BEVERAGES] : BEVERAGES;
  const options = known.map((v) => [v, t(`dye.beverage_${v}`, v)]);
  const v = await openChooser({ title: t('dye.beverage'), options, current });
  if (v != null) await setShotContext({ finalBeverageType: v });
}

const editTds = () => editNumber(t('dye.tds'), ann.value.drinkTds, (v) => setShotAnnotations({ drinkTds: v }), '%');
const editEy = () => editNumber(t('dye.ey'), ann.value.drinkEy, (v) => setShotAnnotations({ drinkEy: v }), '%');

async function editNotes() {
  const v = await openTextField({ title: t('dye.notes'), value: notes.value, multiline: true, placeholder: t('dye.notesPlaceholder') });
  if (v != null) await setShotAnnotations({ espressoNotes: v.trim() === '' ? null : v });
}

const toggleFavorite = () => setShotAnnotations({ extras: { favorite: !favorite.value } });
</script>

<template>
  <div class="dye-page">
    <div class="ov-top balanced">
      <button class="ov-back" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7" /></svg>{{ t('dye.backToGraph') }}
      </button>
      <span class="ov-title">{{ t('dye.title') }}</span>
    </div>

    <!-- Four sections, each answering a different question about the shot:
         which coffee, what came out of it, on what equipment, and who it was
         for. Grouped by SUBJECT rather than by in/out — the way DYE's own
         editor reads — so a hand looking for the grind or the TDS goes to the
         section that owns it instead of down one long list. -->
    <div class="dye-scroll">
      <div class="dye-cols">
        <section class="dye-sect">
          <header class="dye-head">
            <PaperBag aria-hidden="true" />
            <span>{{ t('dye.secBeans') }}</span>
          </header>
          <div class="dye-grid">
            <!-- Both open the bean-then-bag pick (see editBean). -->
            <button class="dye-tile" @click="editBean">
              <span class="dl">{{ t('dye.roaster') }}</span>
              <span class="dv" :class="{ muted: !ctx.coffeeRoaster }">{{ dash(ctx.coffeeRoaster) }}</span>
            </button>
            <button class="dye-tile" @click="editBean">
              <span class="dl">{{ t('dye.bean') }}</span>
              <span class="dv" :class="{ muted: !ctx.coffeeName }">{{ dash(ctx.coffeeName) }}</span>
            </button>
            <!-- Picks which BAG the shot came from — it never edits a bag's
                 roast date, which belongs to the bag (Diary > Bags) and would
                 change every other shot from it too. -->
            <button class="dye-tile" @click="editBag">
              <span class="dl">{{ t('dye.bag') }}</span>
              <span class="dv" :class="{ muted: !roastLabel }">{{ dash(roastLabel) }}</span>
            </button>
            <!-- The bean's own properties, read from the library bean the shot
                 is linked to. Read-only: they describe the BEAN, not this shot,
                 and belong to the Diary's bean editor — change the coffee
                 above to change them here. -->
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.origin') }}</span>
              <span class="dv" :class="{ muted: !beanOrigin }">{{ dash(beanOrigin) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.process') }}</span>
              <span class="dv" :class="{ muted: !shotBean?.processing }">{{ dash(shotBean?.processing) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.variety') }}</span>
              <span class="dv" :class="{ muted: !shotBean?.variety }">{{ dash(shotBean?.variety) }}</span>
            </div>
            <!-- Tasting notes can run long, so they take the grid's full width and
                 wrap when they must — but reserve no second line (.fit), so a
                 short list sits at the height of the tiles beside it. -->
            <div class="dye-tile static dye-span">
              <span class="dl">{{ t('dye.beanNotes') }}</span>
              <span class="dv fit" :class="{ muted: !shotBean?.notes }">{{ dash(shotBean?.notes) }}</span>
            </div>
          </div>
        </section>

        <section class="dye-sect">
          <header class="dye-head">
            <Coffee aria-hidden="true" />
            <span>{{ t('dye.secExtraction') }}</span>
          </header>
          <div class="dye-grid">
            <button class="dye-tile" @click="editDose">
              <span class="dl">{{ t('dye.dose') }}</span>
              <span class="dv" :class="{ muted: actualDose == null }">{{ num(actualDose) ? `${num(actualDose)} g` : '—' }}</span>
            </button>
            <button class="dye-tile" @click="editYield">
              <span class="dl">{{ t('dye.yield') }}</span>
              <span class="dv" :class="{ muted: !yieldLabel }">{{ dash(yieldLabel) }}</span>
            </button>
            <button class="dye-tile" @click="editTargetYield">
              <span class="dl">{{ t('dye.targetYield') }}</span>
              <span class="dv" :class="{ muted: ctx.targetYield == null }">{{ num(ctx.targetYield, 0) ? `${num(ctx.targetYield, 0)} g` : '—' }}</span>
            </button>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.ratio') }}</span>
              <span class="dv" :class="{ muted: !ratioLabel }">{{ dash(ratioLabel) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.time') }}</span>
              <span class="dv" :class="{ muted: !durationLabel }">{{ dash(durationLabel) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.stopReason') }}</span>
              <span class="dv" :class="{ muted: !stopLabel }">{{ dash(stopLabel) }}</span>
            </div>
            <button class="dye-tile" @click="editTds">
              <span class="dl">{{ t('dye.tds') }}</span>
              <span class="dv" :class="{ muted: ann.drinkTds == null }">{{ ann.drinkTds != null ? `${num(ann.drinkTds)} %` : '—' }}</span>
            </button>
            <button class="dye-tile" @click="editEy">
              <span class="dl">{{ t('dye.ey') }}</span>
              <span class="dv" :class="{ muted: ann.drinkEy == null }">{{ ann.drinkEy != null ? `${num(ann.drinkEy)} %` : '—' }}</span>
            </button>
          </div>
        </section>

        <section class="dye-sect">
          <header class="dye-head">
            <LensConcave aria-hidden="true" />
            <span>{{ t('dye.secEquipment') }}</span>
          </header>
          <div class="dye-grid">
            <button class="dye-tile" @click="editGrinder">
              <span class="dl">{{ t('dye.grinder') }}</span>
              <span class="dv" :class="{ muted: !grinderLabel }">{{ dash(grinderLabel) }}</span>
            </button>
            <button class="dye-tile" @click="editGrind">
              <span class="dl">{{ t('dye.grind') }}</span>
              <span class="dv" :class="{ muted: grindSetting == null }">{{ dash(grindSetting) }}</span>
            </button>
            <!-- The profile is the one thing a shot cannot be re-described into:
                 the record carries the frames that were actually run.
                 Its own row, two tiles wide, and wrapping: profile names are
                 long ("D-Flow / Q") and a single tile cut them off. -->
            <div class="dye-tile static dye-profile">
              <span class="dl">{{ t('dye.profile') }}</span>
              <span class="dv fit" :class="{ muted: !profileTitle }">{{ dash(profileTitle) }}</span>
            </div>
            <div class="dye-tile static">
              <span class="dl">{{ t('dye.temperature') }}</span>
              <span class="dv" :class="{ muted: !groupTemp }">{{ dash(groupTemp) }}</span>
            </div>
          </div>
        </section>

        <section class="dye-sect">
          <header class="dye-head">
            <Users aria-hidden="true" />
            <span>{{ t('dye.secPeople') }}</span>
          </header>
          <div class="dye-grid">
            <button class="dye-tile" @click="editBarista">
              <span class="dl">{{ t('dye.barista') }}</span>
              <span class="dv" :class="{ muted: !ctx.baristaName }">{{ dash(ctx.baristaName) }}</span>
            </button>
            <button class="dye-tile" @click="editDrinker">
              <span class="dl">{{ t('dye.drinker') }}</span>
              <span class="dv" :class="{ muted: !ctx.drinkerName }">{{ dash(ctx.drinkerName) }}</span>
            </button>
            <button class="dye-tile" @click="editBeverage">
              <span class="dl">{{ t('dye.beverage') }}</span>
              <span class="dv" :class="{ muted: !ctx.finalBeverageType }">
                {{ ctx.finalBeverageType ? t(`dye.beverage_${ctx.finalBeverageType}`, ctx.finalBeverageType) : '—' }}
              </span>
            </button>
            <button class="dye-tile" @click="toggleFavorite">
              <span class="dl">{{ t('dye.favorite') }}</span>
              <span class="dv" :class="{ 'sw-accent': favorite, muted: !favorite }">{{ favorite ? '★' : '☆' }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- The verdict, under both columns: the one field that belongs to the
           whole shot rather than to any part of it, and the only one that runs
           long enough to want the full width. -->
      <button class="dye-tile dye-note" @click="editNotes">
        <span class="dl">{{ t('dye.notes') }}</span>
        <span class="dv wrap" :class="{ muted: !notes }">{{ notes || t('dye.notesEmpty') }}</span>
      </button>
    </div>

    <!-- The recipe wizard's own two screens. Teleported to <body>: this page
         sits inside the history view's slider, whose transform would otherwise
         become the frame these fixed, full-screen overlays position against —
         they would open inside the slide instead of over the screen. -->
    <Teleport to="body">
      <BeanChooser v-if="picking === 'bean'" @pick="onBeanPicked" @back="picking = null" />
      <BatchPicker v-if="picking === 'bag' && pickedBean" :bean="pickedBean" @pick="onBagPicked" @back="onBagBack" />
    </Teleport>
  </div>
</template>
