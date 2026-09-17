<script setup>
/**
 * Profile editor — modeled on the stock DE1 app's own editor (Steps + Limits
 * tabs), not NSX's. Always edits a DE1 LIBRARY profile: the caller (ProfilePicker's
 * Settings manager, or EspressoView's per-recipe "Edit profile" — which edits
 * the recipe's REFERENCED library profile, not a private copy — see
 * useRecipe.js) does the actual create/update/soft-delete dance via
 * useCore.js's saveLibraryProfile; this component just emits the built
 * profile + the original it started from (see `saved` payload below), which
 * is what saveLibraryProfile needs to pick a save branch.
 *
 * All normalize/serialize logic is pure core (NSXCore.normalizeProfileFrame,
 * .normalizeProfileLimits, .buildProfileFromDraft, .makeDefaultFrame) — this
 * file only holds UI state and dispatches to it.
 */
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openTextField, openNumberPad, openConfirm } from '../../composables/useModals.js';
import { frameName } from '../../composables/useProfileDisplay.js';
import { showToast } from '../../composables/useToast.js';
import { skinSettings } from '../../composables/useSettings.js';
import { isPhone } from '../../composables/useLayout.js';
import SettingSlider from './SettingSlider.vue';
import { dispTemp, toCelsius, tempRange, tempUnitLabel } from '../../composables/useUnits.js';

const props = defineProps({
  record: { type: Object, default: null }, // profile record being edited, or null = new
});

// A Decent-shipped profile is immutable: saving an edit to one creates your own
// copy and leaves the original where it was (useCore's saveLibraryProfile). The
// library manager hides Edit for these; the coffee page keeps it, because
// editing the profile your recipe uses is a reasonable thing to want — so the
// editor has to say which of the two it is doing before you press Save.
const isFork = computed(() => props.record?.isDefault === true);
const emit = defineEmits(['close', 'saved']);
const { t } = useI18n();
const { NSXCore } = window;

const sourceProfile = props.record?.profile ?? null;
// Deep clone: buildProfileFromDraft's key-shape preservation reads this, and
// it must never alias the live record/recipe the editor was opened from.
const originalProfile = sourceProfile ? JSON.parse(JSON.stringify(sourceProfile)) : null;

const rawFrames = sourceProfile ? (sourceProfile.steps ?? sourceProfile.frames ?? []) : [];

const draft = reactive({
  title: sourceProfile?.title || '',
  author: sourceProfile?.author || '',
  notes: sourceProfile?.notes || '',
  // DE1 profile classification (Profile.beverage_type). Preserved for imported
  // profiles, defaults to espresso for new ones — see buildProfileFromDraft.
  beverageType: sourceProfile?.beverage_type || 'espresso',
  groupTemp: NSXCore.resolveProfileTemp(sourceProfile) ?? 93,
  frames: rawFrames.map((f) => NSXCore.normalizeProfileFrame(f)),
  limits: NSXCore.normalizeProfileLimits(sourceProfile, rawFrames),
});
if (!draft.frames.length) draft.frames.push(NSXCore.makeDefaultFrame(null));

// Dirty tracking covers EVERY persisted field (title/author/notes/frames/
// limits) — NSX's own snapshot omitted tank-temp and limiter ranges, so
// changing only those never marked dirty and silently failed to persist.
const initialSnapshot = JSON.stringify(draft);
const dirty = computed(() => JSON.stringify(draft) !== initialSnapshot);

const activeTab = ref('steps'); // 'steps' | 'limits' | 'info'
// DE1 Profile.beverage_type options, in the stock app's order.
const BEVERAGE_TYPES = ['espresso', 'calibrate', 'cleaning', 'manual', 'pourover'];
function setBeverageType(ty) { draft.beverageType = ty; }
const selectedFrameIdx = ref(0);
const selectedFrame = computed(() => draft.frames[selectedFrameIdx.value] ?? null);

// Phone-only: which pane of the Steps tab is showing. Unlike ProfilePicker,
// there's no "nothing selected" state to key off here — a profile always has
// at least one frame, so selectedFrameIdx is never null. This ref is the
// substitute: false = the step list (+ its add/duplicate/move/delete row +
// the whole-profile plot), true = the selected step's own editable groups.
// Both panes always show on the tablet regardless (see showStepList/
// showStepDetail below) — isPhone gates every write to this ref, so it can
// never even become true there.
const phoneShowingStepDetail = ref(false);
const showStepList = computed(() => !isPhone.value || !phoneShowingStepDetail.value);
const showStepDetail = computed(() => !isPhone.value || phoneShowingStepDetail.value);

function selectFrame(idx) {
  selectedFrameIdx.value = idx;
  if (isPhone.value) phoneShowingStepDetail.value = true;
}

function plotSvg() {
  return NSXCore.renderProfileSpark({ title: draft.title, steps: draft.frames }, {
    // See ProfilePicker.plotSvg — pinned to 'dark', the preview came out as a
    // dark slab on the light theme.
    theme: skinSettings.theme === 'light' ? 'light' : 'dark', showLegend: false, showXTicks: false, showYTicks: false, showStageLabels: false,
    showTempLine: false, compactMargins: true, selectedFrameIdx: selectedFrameIdx.value, pressureMax: 12,
  });
}

// ── Step list actions (Add/Duplicate/Move/Delete — buttons only, matching
// the stock app and NSX alike; no drag-reorder in either reference) ────────
function addFrame() {
  draft.frames.push(NSXCore.makeDefaultFrame(draft.frames[draft.frames.length - 1] ?? null));
  selectedFrameIdx.value = draft.frames.length - 1;
  if (isPhone.value) phoneShowingStepDetail.value = true;
}
function duplicateFrame() {
  if (!selectedFrame.value) return;
  const copy = JSON.parse(JSON.stringify(selectedFrame.value));
  draft.frames.splice(selectedFrameIdx.value + 1, 0, copy);
  selectedFrameIdx.value += 1;
  if (isPhone.value) phoneShowingStepDetail.value = true;
}
function moveFrame(delta) {
  const i = selectedFrameIdx.value;
  const j = i + delta;
  if (j < 0 || j >= draft.frames.length) return;
  [draft.frames[i], draft.frames[j]] = [draft.frames[j], draft.frames[i]];
  selectedFrameIdx.value = j;
}
async function deleteFrame() {
  if (draft.frames.length <= 1) return; // a profile needs at least one step
  const ok = await openConfirm({
    title: t('profileEditor.deleteStepTitle'), danger: true, confirmLabel: t('common.delete'),
  });
  if (!ok) return;
  draft.frames.splice(selectedFrameIdx.value, 1);
  selectedFrameIdx.value = Math.min(selectedFrameIdx.value, draft.frames.length - 1);
}

// ── Text fields (title/author/notes/step name) — tap-to-edit via the shared
// on-screen keyboard, matching BeanEditor's own convention. ────────────────
async function editText(getCurrent, setValue, title, opts = {}) {
  const v = await openTextField({ title, value: getCurrent(), ...opts });
  if (v != null) setValue(v);
}
const editTitle = () => editText(() => draft.title, (v) => { draft.title = v; }, t('profileEditor.title'));
const editAuthor = () => editText(() => draft.author, (v) => { draft.author = v; }, t('profileEditor.author'));
const editNotes = () => editText(() => draft.notes, (v) => { draft.notes = v; }, t('profileEditor.notes'), { multiline: true });
const editStepName = () => editText(
  () => selectedFrame.value?.name || '',
  (v) => { if (selectedFrame.value) selectedFrame.value.name = v; },
  t('profileEditor.stepName'),
);

// ── Numeric fields — SettingSlider's drag path already clamps to [min,max];
// its tap-to-numberpad path (below) does not, matching every existing
// SettingSlider caller in MachinePanel.vue (none of them clamp the typed
// value either — the user's typed number is trusted as-is). ───────────────
/** A temperature pad: shows the display unit, stores Celsius. */
async function editTempField(getter, setter, title) {
  const v = await openNumberPad({ title, unit: tempUnitLabel.value, value: dispTemp(getter()) });
  if (v != null) setter(toCelsius(parseFloat(v) || 0));
}

/** The selected frame's own temperature, same conversion as editTempField. */
async function editFrameTemp() {
  const f = selectedFrame.value;
  if (!f) return;
  const v = await openNumberPad({
    title: t('profileEditor.temperature'), unit: tempUnitLabel.value, value: dispTemp(f.temperature),
  });
  if (v != null) f.temperature = toCelsius(parseFloat(v) || 0);
}

async function editFrameField(field, title, unit) {
  const f = selectedFrame.value;
  if (!f) return;
  const v = await openNumberPad({ title, unit, value: f[field] });
  if (v != null) f[field] = parseFloat(v) || 0;
}

// A step's limiter/volume/weight have no separate on/off switch in the stock
// app — "off" IS the slider's floor (0), exactly like every 0-means-off
// SettingSlider already in MachinePanel.vue. limiterEnabled/volumeEnabled/
// weightEnabled (read by buildProfileFromDraft) just track "value > 0".
function setFrameValue(field, enabledField, value) {
  const f = selectedFrame.value;
  if (!f) return;
  f[field] = value;
  f[enabledField] = value > 0;
}
async function editFrameValueField(field, enabledField, title, unit) {
  const f = selectedFrame.value;
  if (!f) return;
  const v = await openNumberPad({ title, unit, value: f[field] });
  if (v == null) return;
  setFrameValue(field, enabledField, parseFloat(v) || 0);
}

// Goal/limit swap with pump mode: a pressure-goal frame's limiter caps flow,
// and vice versa (the DE1 always limits the OPPOSITE axis from the goal).
const goalField = computed(() => (selectedFrame.value?.pump === 'flow' ? 'flow' : 'pressure'));
const goalLabel = computed(() => (selectedFrame.value?.pump === 'flow' ? t('profileEditor.flowGoal') : t('profileEditor.pressureGoal')));
/* Ranges are the ESPRESSO range, not the machine's. The DE1 will accept 14 bar
   and 120 s, but a 14-bar track spends most of its width on values no espresso
   frame uses, and on a ~300px slider that put roughly a bar under every 20px —
   which is what made these unusable by finger. Tightened to where real frames
   live; anything beyond is still reachable by tapping the value and typing it,
   and SettingSlider widens itself around such a value so it can't be clamped
   away by a stray touch.
   The step is a whole unit for both, so dragging lands on 6 bar or 4 ml/s
   rather than 6.3 — a tenth of a bar is not a decision a finger should be able
   to make by accident. `decimals` stays at 1 anyway: a value typed as 8.5 must
   still READ as 8.5 rather than being rounded away in the display. */
const goalMax = computed(() => (selectedFrame.value?.pump === 'flow' ? 12 : 9));
const goalUnit = computed(() => (selectedFrame.value?.pump === 'flow' ? ' ml/s' : ' bar'));
const limitLabel = computed(() => (selectedFrame.value?.pump === 'flow' ? t('profileEditor.pressureLimit') : t('profileEditor.flowLimit')));
const limitMax = computed(() => (selectedFrame.value?.pump === 'flow' ? 9 : 12));
const limitUnit = computed(() => (selectedFrame.value?.pump === 'flow' ? ' bar' : ' ml/s'));

function setPumpMode(mode) { if (selectedFrame.value) selectedFrame.value.pump = mode; }
function setSensor(sensor) { if (selectedFrame.value) selectedFrame.value.sensor = sensor; }
function setTransition(transition) { if (selectedFrame.value) selectedFrame.value.transition = transition; }

// Exit condition — a single 4-way choice (pressure/flow × over/under); the
// canonical persisted shape is one nested {type,condition,value} object, so
// only one of these four can be active at a time. `weight` exists in the raw
// schema but has no selector in the stock app either — it survives untouched
// via normalizeProfileFrame/buildProfileFromDraft if an imported profile
// already carries it, it's just not something this editor can newly set.
const EXIT_TYPES = ['pressure_over', 'pressure_under', 'flow_over', 'flow_under'];
function setExitType(type) { if (selectedFrame.value) selectedFrame.value.exitType = type; }
function toggleExitEnabled() { if (selectedFrame.value) selectedFrame.value.exitEnabled = !selectedFrame.value.exitEnabled; }
const exitIsFlow = computed(() => String(selectedFrame.value?.exitType || '').startsWith('flow'));
const exitMax = computed(() => (exitIsFlow.value ? 12 : 9));
const exitUnit = computed(() => (exitIsFlow.value ? ' ml/s' : ' bar'));

// ── Limits tab (profile-global fields) — same 0-means-off convention as the
// per-frame volume/weight/limiter sliders above. ───────────────────────────
async function editLimitField(getter, setter, title, unit) {
  const v = await openNumberPad({ title, unit, value: getter() });
  if (v != null) setter(parseFloat(v) || 0);
}
function setTankTemp(v) { draft.limits.tankTempValue = v; draft.limits.tankTempEnabled = v > 0; }
function setStopVolumeStart(v) { draft.limits.stopVolumeStartIndex = v; }
function setStopVolume(v) { draft.limits.stopVolumeValue = v; draft.limits.stopVolumeEnabled = v > 0; }
function setStopWeight(v) { draft.limits.stopWeightValue = v; draft.limits.stopWeightEnabled = v > 0; }

const editTankTemp = () => editTempField(() => draft.limits.tankTempValue, setTankTemp, t('profileEditor.preheat'));
const editStopVolumeStart = () => editLimitField(() => draft.limits.stopVolumeStartIndex, setStopVolumeStart, t('profileEditor.volumeCountStart'), '');
// The frame INDEX is what's actually stored/edited, but "frame 2" means
// nothing at a glance — show the frame's own name (or its "Stage N" fallback)
// once the slider settles. See SettingSlider's textValue prop.
const stopVolumeStartFrameName = computed(() => {
  const idx = draft.limits.stopVolumeStartIndex;
  const f = draft.frames[idx];
  return f ? frameName(f, idx, t) : String(idx);
});
const editStopVolume = () => editLimitField(() => draft.limits.stopVolumeValue, setStopVolume, t('profileEditor.stopVolume'), 'ml');
const editStopWeight = () => editLimitField(() => draft.limits.stopWeightValue, setStopWeight, t('profileEditor.stopWeight'), 'g');

// ── Save ────────────────────────────────────────────────────────────────
async function attemptClose() {
  if (!dirty.value) { emit('close'); return; }
  const ok = await openConfirm({
    title: t('profileEditor.discardTitle'), message: t('profileEditor.discardMessage'),
    danger: true, confirmLabel: t('profileEditor.discardConfirm'),
  });
  if (ok) emit('close');
}

function save() {
  const built = NSXCore.buildProfileFromDraft(draft, originalProfile);
  // The group temperature belongs to the RECIPE, not to the profile. The
  // recipe's Temp dial is what raises or lowers a shot: buildGatewayPayload
  // shifts every frame by (dialed − the profile's own temperature) on push, so
  // the profile only ever states the temperatures its frames run at.
  //
  // buildProfileFromDraft writes a profile-level `groupTemp` for NSX, whose
  // editor has a control for it that moves the frames with it. Nova has no such
  // control — its temperature slider edits the selected frame — so the value
  // would be whatever the profile read as when this editor opened, left behind
  // as the baseline the dial measures from. Edit the frames from 93 to 95 and
  // the recipe would still read 93, and dialling 95 to "fix" it pushed 97.
  delete built.groupTemp;
  emit('saved', { profile: built, originalProfile });
}
</script>

<template>
  <div class="overlay-full pe-overlay">
    <div class="ov-top">
      <button class="ov-back" @click="attemptClose">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <span class="ov-title">{{ draft.title || t('profilePicker.unnamed') }}</span>
      <button class="sort-btn accent lg" @click="save">{{ isFork ? t('profileEditor.saveCopy') : t('common.save') }}</button>
    </div>

    <!-- The tabs stay centred with the fork notice beside them, not above: a
         line of its own pushed every tab's content down whenever a Decent
         profile was open. Three columns so the side the notice is NOT on is
         the same width as the side it is, which is what keeps the tabs in the
         middle. -->
    <div class="pe-tabrow">
      <span aria-hidden="true"></span>
      <div class="seg pe-tabseg" :data-pos="activeTab === 'info' ? 2 : activeTab === 'limits' ? 1 : 0">
        <span class="seg-thumb"></span>
        <button :class="{ on: activeTab === 'steps' }" @click="activeTab = 'steps'">{{ t('profileEditor.tabSteps') }}</button>
        <button :class="{ on: activeTab === 'limits' }" @click="activeTab = 'limits'">{{ t('profileEditor.tabLimits') }}</button>
        <button :class="{ on: activeTab === 'info' }" @click="activeTab = 'info'">{{ t('profileEditor.tabInfo') }}</button>
      </div>
      <p v-if="isFork" class="pe-fork-note">{{ t('profileEditor.forkNotice') }}</p>
    </div>

    <div v-if="activeTab === 'steps'" class="pick-body pe-body">
      <div class="pick-list" v-show="showStepList">
        <div class="pick-items">
          <button
            v-for="(f, i) in draft.frames"
            :key="i"
            class="pick-item"
            :class="{ sel: i === selectedFrameIdx }"
            @click="selectFrame(i)"
          >
            <span class="pname">{{ frameName(f, i, t) }}</span>
          </button>
        </div>

        <!-- Icon-only actions: the text labels ate a whole row's width; the
             glyph + aria-label keeps the same meaning in a fraction of the space. -->
        <div class="pe-frame-actions">
          <button :aria-label="t('profileEditor.add')" :title="t('profileEditor.add')" @click="addFrame">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button :aria-label="t('profileEditor.duplicate')" :title="t('profileEditor.duplicate')" :disabled="!selectedFrame" @click="duplicateFrame">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
          </button>
          <button :aria-label="t('profileEditor.moveUp')" :title="t('profileEditor.moveUp')" :disabled="selectedFrameIdx === 0" @click="moveFrame(-1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
          <button :aria-label="t('profileEditor.moveDown')" :title="t('profileEditor.moveDown')" :disabled="selectedFrameIdx >= draft.frames.length - 1" @click="moveFrame(1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
          </button>
          <button class="danger" :aria-label="t('common.delete')" :title="t('common.delete')" :disabled="draft.frames.length <= 1" @click="deleteFrame">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" /></svg>
          </button>
        </div>

        <div class="pick-plot" v-html="plotSvg()"></div>
      </div>

      <div v-if="selectedFrame" class="pick-detail pe-detail" v-show="showStepDetail">
        <!-- Phone only: the tablet always shows the step list beside this, so
             it never needs a way back to it. The actions row is repeated here
             too — on the tablet it lives once, in .pick-list, but on the
             phone that pane is hidden while a step's detail is open, and
             duplicate/reorder/delete act on THIS step, not on whichever the
             list happens to be scrolled to. -->
        <div v-if="isPhone" class="pe-phone-detail-head">
          <button class="phone-back" :aria-label="t('profileEditor.tabSteps')" @click="phoneShowingStepDetail = false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div class="pe-frame-actions">
            <button :aria-label="t('profileEditor.add')" :title="t('profileEditor.add')" @click="addFrame">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button :aria-label="t('profileEditor.duplicate')" :title="t('profileEditor.duplicate')" :disabled="!selectedFrame" @click="duplicateFrame">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            </button>
            <button :aria-label="t('profileEditor.moveUp')" :title="t('profileEditor.moveUp')" :disabled="selectedFrameIdx === 0" @click="moveFrame(-1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
            <button :aria-label="t('profileEditor.moveDown')" :title="t('profileEditor.moveDown')" :disabled="selectedFrameIdx >= draft.frames.length - 1" @click="moveFrame(1)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
            </button>
            <button class="danger" :aria-label="t('common.delete')" :title="t('common.delete')" :disabled="draft.frames.length <= 1" @click="deleteFrame">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" /></svg>
            </button>
          </div>
        </div>
        <button class="pe-step-title" @click="editStepName">
          {{ selectedFrame.name || t('profileEditor.stepName') }}<span class="sr-chev">›</span>
        </button>

        <div class="pe-groups">
          <!-- Two independently-stacked columns rather than a 2x2 grid: a grid
               row would force each tile to match the height of the one beside
               it, leaving the shorter one half-empty. Stacked columns let each
               tile size to its own content instead. Read down each column:
               1 Temperature, 2 Goal on the left; 3 Maximum, 4 Move on if on the
               right. -->
          <div class="pe-col">
            <div class="pe-group">
              <span class="pd-panel-label">{{ t('profileEditor.groupTemperature') }}</span>
              <SettingSlider
                :label="t('profileEditor.temperature')" :model-value="dispTemp(selectedFrame.temperature)"
                v-bind="tempRange(70, 100)" :unit="tempUnitLabel"
                @change="selectedFrame.temperature = toCelsius($event)" @edit="editFrameTemp"
              />
              <div class="pe-seg-row">
                <span class="pe-seg-label">{{ t('profileEditor.sensor') }}</span>
                <div class="seg pe-seg-sm" :data-pos="selectedFrame.sensor === 'water' ? 1 : 0">
                  <span class="seg-thumb"></span>
                  <button :class="{ on: selectedFrame.sensor === 'coffee' }" @click="setSensor('coffee')">{{ t('profileEditor.sensorCoffee') }}</button>
                  <button :class="{ on: selectedFrame.sensor === 'water' }" @click="setSensor('water')">{{ t('profileEditor.sensorWater') }}</button>
                </div>
              </div>
            </div>

            <div class="pe-group">
              <span class="pd-panel-label">{{ t('profileEditor.groupGoal') }}</span>
              <div class="pe-seg-row">
                <span class="pe-seg-label">{{ t('profileEditor.pumpMode') }}</span>
                <div class="seg pe-seg-sm" :data-pos="selectedFrame.pump === 'flow' ? 1 : 0">
                  <span class="seg-thumb"></span>
                  <button :class="{ on: selectedFrame.pump === 'pressure' }" @click="setPumpMode('pressure')">{{ t('profilePicker.pumpPressure') }}</button>
                  <button :class="{ on: selectedFrame.pump === 'flow' }" @click="setPumpMode('flow')">{{ t('profilePicker.pumpFlow') }}</button>
                </div>
              </div>
              <SettingSlider
                :label="goalLabel" :model-value="selectedFrame[goalField]"
                :min="0" :max="goalMax" :step="1" :decimals="1" :unit="goalUnit"
                @change="selectedFrame[goalField] = $event" @edit="editFrameField(goalField, goalLabel, goalUnit)"
              />
              <SettingSlider
                :label="limitLabel" :model-value="selectedFrame.limiterValue"
                :min="0" :max="limitMax" :step="1" :decimals="1" :unit="limitUnit" :off-label="t('common.off')"
                @change="setFrameValue('limiterValue', 'limiterEnabled', $event)"
                @edit="editFrameValueField('limiterValue', 'limiterEnabled', limitLabel, limitUnit)"
              />
              <!-- How softly that limit engages, for THIS step: the DE1 keeps a
                   range on every limiter, and profiles do vary it step to step
                   (Decent's own Baseline ones hold one step hard at 0 while
                   another eases in). Only shown when there is a limit to soften
                   — a range under an "off" limiter is a control with no effect.
                   0 is a real setting here, so it reads "hard" rather than
                   "off": the limiter is still on. -->
              <SettingSlider
                v-if="selectedFrame.limiterEnabled"
                :label="t('profileEditor.limitRange')" :model-value="selectedFrame.limiterRange"
                :min="0" :max="5" :step="0.1" :decimals="1" :unit="limitUnit"
                :off-label="t('profileEditor.limitRangeHard')"
                @change="selectedFrame.limiterRange = $event"
                @edit="editFrameField('limiterRange', t('profileEditor.limitRange'), limitUnit)"
              />
              <div class="pe-seg-row">
                <span class="pe-seg-label">{{ t('profileEditor.transition') }}</span>
                <div class="seg pe-seg-sm" :data-pos="selectedFrame.transition === 'smooth' ? 1 : 0">
                  <span class="seg-thumb"></span>
                  <button :class="{ on: selectedFrame.transition === 'fast' }" @click="setTransition('fast')">{{ t('profileEditor.transitionFast') }}</button>
                  <button :class="{ on: selectedFrame.transition === 'smooth' }" @click="setTransition('smooth')">{{ t('profileEditor.transitionSmooth') }}</button>
                </div>
              </div>
            </div>
          </div>

          <div class="pe-col">
            <div class="pe-group">
              <span class="pd-panel-label">{{ t('profileEditor.groupMax') }}</span>
              <SettingSlider
                :label="t('profileEditor.time')" :model-value="selectedFrame.seconds"
                :min="0" :max="30" :step="1" unit=" s"
                @change="selectedFrame.seconds = $event" @edit="editFrameField('seconds', t('profileEditor.time'), ' s')"
              />
              <SettingSlider
                :label="t('profileEditor.volume')" :model-value="selectedFrame.volumeValue"
                :min="0" :max="50" :step="1" unit=" ml" :off-label="t('common.off')"
                @change="setFrameValue('volumeValue', 'volumeEnabled', $event)"
                @edit="editFrameValueField('volumeValue', 'volumeEnabled', t('profileEditor.volume'), ' ml')"
              />
              <SettingSlider
                :label="t('profileEditor.weight')" :model-value="selectedFrame.weightValue"
                :min="0" :max="50" :step="1" unit=" g" :off-label="t('common.off')"
                @change="setFrameValue('weightValue', 'weightEnabled', $event)"
                @edit="editFrameValueField('weightValue', 'weightEnabled', t('profileEditor.weight'), ' g')"
              />
            </div>

            <div class="pe-group">
            <div class="pe-group-header">
              <span class="pd-panel-label">{{ t('profileEditor.groupExit') }}</span>
              <button class="switch sm" :class="{ on: selectedFrame.exitEnabled }" role="switch" :aria-checked="selectedFrame.exitEnabled" @click="toggleExitEnabled"></button>
            </div>
            <template v-if="selectedFrame.exitEnabled">
              <div class="pe-exit-grid">
                <button :class="{ on: selectedFrame.exitType === 'pressure_over' }" @click="setExitType('pressure_over')">{{ t('profileEditor.exitPressureOver') }}</button>
                <button :class="{ on: selectedFrame.exitType === 'pressure_under' }" @click="setExitType('pressure_under')">{{ t('profileEditor.exitPressureUnder') }}</button>
                <button :class="{ on: selectedFrame.exitType === 'flow_over' }" @click="setExitType('flow_over')">{{ t('profileEditor.exitFlowOver') }}</button>
                <button :class="{ on: selectedFrame.exitType === 'flow_under' }" @click="setExitType('flow_under')">{{ t('profileEditor.exitFlowUnder') }}</button>
              </div>
              <SettingSlider
                :label="t('profileEditor.exitValue')" :model-value="selectedFrame.exitValue"
                :min="0" :max="exitMax" :step="1" :decimals="1" :unit="exitUnit"
                @change="selectedFrame.exitValue = $event" @edit="editFrameField('exitValue', t('profileEditor.exitValue'), exitUnit)"
              />
            </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="activeTab === 'limits'" class="settings-scroll pe-limits">
      <SettingSlider
        :label="t('profileEditor.preheat')" :model-value="dispTemp(draft.limits.tankTempValue)"
        v-bind="tempRange(0, 100)" :unit="tempUnitLabel"
        :off-label="t('common.off')" :off-value="tempRange(0, 100).min"
        @change="setTankTemp(toCelsius($event))" @edit="editTankTemp"
      />

      <!-- Preinfusion: which frame it ends after, and what it stops the shot
           at once that frame is reached — one logical group, one panel. -->
      <div class="pe-group">
        <SettingSlider
          :label="t('profileEditor.volumeCountStart')" :model-value="draft.limits.stopVolumeStartIndex"
          :text-value="stopVolumeStartFrameName"
          :min="0" :max="Math.max(0, draft.frames.length - 1)" :step="1"
          @change="setStopVolumeStart" @edit="editStopVolumeStart"
        />
        <SettingSlider
          :label="t('profileEditor.stopVolume')" :model-value="draft.limits.stopVolumeValue"
          :min="0" :max="1000" :step="10" unit=" ml" :off-label="t('common.off')"
          @change="setStopVolume" @edit="editStopVolume"
        />
      </div>

      <SettingSlider
        :label="t('profileEditor.stopWeight')" :model-value="draft.limits.stopWeightValue"
        :min="0" :max="100" :step="1" unit=" g" :off-label="t('common.off')"
        @change="setStopWeight" @edit="editStopWeight"
      />
    </div>

    <div v-else class="settings-scroll">
      <button class="setting-row as-btn" @click="editTitle">
        <span class="sr-name">{{ t('profileEditor.title') }}</span>
        <span class="sr-value">{{ draft.title || '—' }}<span class="sr-chev">›</span></span>
      </button>
      <button class="setting-row as-btn" @click="editAuthor">
        <span class="sr-name">{{ t('profileEditor.author') }}</span>
        <span class="sr-value">{{ draft.author || '—' }}<span class="sr-chev">›</span></span>
      </button>
      <div class="pe-type-block">
        <span class="sr-name">{{ t('profileEditor.beverageType') }}</span>
        <div class="pe-type-grid">
          <button
            v-for="ty in BEVERAGE_TYPES"
            :key="ty"
            :class="{ on: draft.beverageType === ty }"
            @click="setBeverageType(ty)"
          >{{ t(`profileEditor.beverageTypes.${ty}`) }}</button>
        </div>
      </div>

      <button class="setting-row as-btn stacked" @click="editNotes">
        <span class="sr-name">{{ t('profileEditor.notes') }}<span class="sr-chev">›</span></span>
        <span class="sr-value muted">{{ draft.notes || '—' }}</span>
      </button>
    </div>
  </div>
</template>
