<script setup>
/**
 * List + plot + description, in two modes:
 *   "pick"   — Change profile / new-recipe step 2. Selecting emits 'select'.
 *   "manage" — Settings' profile library: New/Edit open ProfileEditor
 *              (mode="library"); delete uses the edit-mode + trash-icon rows.
 *              Import remains out of scope.
 * One renderer serves both, per the design log ("ein Renderer, zwei Einstiege").
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { profiles, profilesAll, refreshProfiles, refreshProfilesAll, saveLibraryProfile, shots } from '../composables/useCore.js';
import { showToast } from '../composables/useToast.js';
import { frames, frameDetailText, frameName } from '../composables/useProfileDisplay.js';
import { openConfirm, openChooser } from '../composables/useModals.js';
import { skinSettings } from '../composables/useSettings.js';
import { isPhone } from '../composables/useLayout.js';
import { fmtTemp } from '../composables/useUnits.js';
import ProfileEditor from './settings/ProfileEditor.vue';

const props = defineProps({
  mode: { type: String, default: 'pick' }, // 'pick' | 'manage'
  currentTitle: { type: String, default: '' },
  // Overrides the pick-mode confirm button's label; empty keeps "Select".
  confirmLabel: { type: String, default: '' },
});
const emit = defineEmits(['select', 'back']);

const { t } = useI18n();
const { NSXCore, NSXApi } = window;
const isUserOwned = NSXCore.isUserOwnedProfile;

// The "show hidden" eye toggle — lazily loads the visible+hidden cache on
// first use (RecipePicker's own load-on-open convention), and excludes
// soft-deleted records the same way NSX's toggle does (includeHidden=true
// also returns the trash, which isn't what "hidden" means here).
const showHidden = ref(false);
const hiddenLoaded = ref(false);
async function toggleShowHidden() {
  showHidden.value = !showHidden.value;
  if (showHidden.value && !hiddenLoaded.value) {
    hiddenLoaded.value = true;
    await refreshProfilesAll();
  }
}
const sourceList = computed(() => (
  showHidden.value ? profilesAll.value.filter((p) => p.visibility !== 'deleted') : profiles.value
));
const myProfiles = computed(() => sourceList.value.filter(isUserOwned));
const decentProfiles = computed(() => sourceList.value.filter((p) => !isUserOwned(p)));

/**
 * The three profiles most recently brewed with, above the library — the same
 * shortcut the bean step has (BeanChooser.vue), and for the same reason: a new
 * recipe is usually a variation on what you have been pulling, which otherwise
 * means finding it again among tabs, type filters and every Decent default.
 *
 * Matched by TITLE, which is what a shot records; a profile since edited into
 * a new record still resolves, and one deleted from the library drops out.
 * Only in pick mode — the library screen is for managing, not repeating.
 */
const recentProfiles = computed(() => {
  if (props.mode !== 'pick') return [];
  return NSXCore.recentFromShots(shots.value, (shot) => {
    const title = shot?.workflow?.profile?.title || shot?.workflow?.context?.profileTitle;
    return title ? sourceList.value.find((p) => (p.profile?.title || '') === title) ?? null : null;
  });
});

const selectedId = ref(
  profiles.value.find((p) => (p.profile?.title || '') === props.currentTitle)?.id ?? null
);
const selected = computed(() => sourceList.value.find((p) => p.id === selectedId.value) ?? null);

// The tablet shows list and detail side by side (.pick-body); a phone screen
// has room for exactly one. Rather than a phone-only fork of this 468-line
// component (frame math, four save branches, hidden/visibility handling —
// all of it would have to be duplicated and would drift the first time the
// tablet version changed), this is the one boolean that turns the same
// markup into "list → tap → detail → back". Resolves true on the tablet
// (isPhone false) regardless of selection, so the list pane there is never
// hidden — the v-show below only actually does anything on the phone. The
// detail pane needs no equivalent flag: it's already `v-if="selected"`,
// which is exactly the phone's other state (selectedId set = show detail).
const showList = computed(() => !isPhone.value || selectedId.value == null);
// The header's own Back normally leaves the picker entirely (emit('back')).
// On the phone, while a detail is open, it should step back to the list
// first — the same one-level-at-a-time back every other drill-down screen in
// this skin uses (DiaryTab's goBack, RecipeDetail's close). Only once the
// list itself is what's showing does it fall through to actually leaving.
function onBackTap() {
  if (isPhone.value && selectedId.value != null) selectedId.value = null;
  else emit('back');
}

// Which group is on screen — always opens on Decent's factory profiles,
// regardless of which group the current profile lives in.
const activeGroup = ref('decent');
const groupProfiles = computed(() => (activeGroup.value === 'user' ? myProfiles.value : decentProfiles.value));

// Second-level filter, below the Decent/Custom toggle: Profile.beverage_type
// (see ProfileEditor's Info tab, which is where this gets set/edited).
// 'all' = no filter. A profile with no beverage_type at all defaults to
// 'espresso', matching buildProfileFromDraft's own default for new profiles.
// Split into two rows by how often they're actually used — espresso/pour-over
// get their own (bigger) row, the occasional/utility types share a smaller one
// above it, alongside "All".
const SMALL_TYPES = ['calibrate', 'cleaning', 'manual'];
const BIG_TYPES = ['espresso', 'pourover'];
// Opens on espresso, not "All" — that's the profile you're picking almost
// every time; "All" and the other types are one tap away.
const activeType = ref('espresso');
function beverageTypeOf(p) { return p.profile?.beverage_type || 'espresso'; }
const visibleProfiles = computed(() => (
  activeType.value === 'all' ? groupProfiles.value : groupProfiles.value.filter((p) => beverageTypeOf(p) === activeType.value)
));

// Titles of the form "Group/Name" (e.g. "Cleaning/Forward Flush x5") render as
// a group header with its members indented underneath — mirrors NSX's
// _profileGroupOf/_renderProfilePickerList grouping. Applies to both tabs:
// Decent's own factory profiles use the same "Group/Name" convention too
// (e.g. a cleaning/maintenance profile bundled alongside the espresso ones).
function groupOf(title) {
  const idx = String(title || '').indexOf('/');
  if (idx > 0) return { group: title.slice(0, idx).trim(), name: title.slice(idx + 1).trim() };
  return { group: null, name: String(title || '') };
}
const entries = computed(() => {
  const groups = new Map();
  const sortable = [];
  for (const p of visibleProfiles.value) {
    const { group, name } = groupOf(p.profile?.title || '');
    if (group) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ kind: 'item', id: p.id, profile: p, name, grouped: true });
    } else {
      sortable.push({ sortKey: name, rows: [{ kind: 'item', id: p.id, profile: p, name, grouped: false }] });
    }
  }
  for (const [group, members] of groups) {
    sortable.push({ sortKey: group, rows: [{ kind: 'group', id: `group:${group}`, label: group }, ...members] });
  }
  // 'de' was a leftover from the shared core's shot/recipe-key normalisation
  // convention — Nova is English-only (main.js forces setLang('en')), so this
  // was sorting an English profile list with German collation rules for no
  // reason. NSXI18n.getLocale() follows whatever language is actually active.
  sortable.sort((a, b) => a.sortKey.localeCompare(b.sortKey, window.NSXI18n?.getLocale?.() ?? 'en-US'));
  return sortable.flatMap((s) => s.rows);
});

// Delete/hide act on the SELECTED profile, alongside Edit in the detail
// pane's action row — not per-row list buttons. Delete is Custom-only
// (Decent defaults can only be copied or hidden, never removed or changed in
// place, per the DE1's own rule — Edit copies one, see openEditProfile) and
// confirms first: unlike the old per-row trash icon (which had a
// "toggle edit mode, then tap" two-step guard built in), this is now a
// single top-level tap, so a confirm step replaces that lost friction. Hide
// applies to BOTH tabs — a Decent default can be hidden just as well as a
// user profile — and is reversible, so it skips the confirm.
async function deleteSelected() {
  const record = selected.value;
  if (!record) return;
  const ok = await openConfirm({
    title: t('profilePicker.deleteConfirmTitle'),
    message: record.profile?.title || '',
    danger: true,
    confirmLabel: t('common.delete'),
  });
  if (!ok) return;
  try {
    await NSXApi.deleteProfile(record.id);
    NSXCore.invalidateProfiles();
    NSXCore.invalidateProfilesAll();
    NSXCore.invalidateDeletedProfiles();
    await refreshProfiles(true);
    if (hiddenLoaded.value) await refreshProfilesAll(true);
    if (selectedId.value === record.id) selectedId.value = null;
  } catch (err) {
    console.error('[Nova] failed to delete profile', err?.message);
  }
}
// The next (else previous) profile row after `id` in the on-screen list —
// read BEFORE the hide takes effect, since `entries` still contains the
// about-to-be-hidden record at that point. Skips group-header rows.
function neighborId(id) {
  const items = entries.value.filter((e) => e.kind === 'item');
  const idx = items.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  return (items[idx + 1] ?? items[idx - 1] ?? null)?.id ?? null;
}

async function toggleSelectedVisibility() {
  const record = selected.value;
  if (!record) return;
  const hiding = record.visibility !== 'hidden';
  const nextVisibility = hiding ? 'hidden' : 'visible';
  // Hiding drops the record out of the list — but only while showHidden is
  // off; with it on, the row stays put (just dimmed via is-hidden), so there's
  // nothing to fall back from. Land on whichever profile was next to it
  // instead of leaving the detail pane empty. Unhiding keeps the selection.
  const fallbackId = hiding && !showHidden.value ? neighborId(record.id) : null;
  try {
    await NSXApi.setProfileVisibility(record.id, nextVisibility);
    NSXCore.invalidateProfiles();
    NSXCore.invalidateProfilesAll();
    await refreshProfiles(true);
    if (hiddenLoaded.value) await refreshProfilesAll(true);
    if (hiding && !showHidden.value && selectedId.value === record.id) selectedId.value = fallbackId;
  } catch (err) {
    console.error('[Nova] failed to change profile visibility', err?.message);
  }
}

function peakPressure(p) {
  const vals = frames(p).map((f) => Number(f?.pressure)).filter(Number.isFinite);
  return vals.length ? `${Math.max(...vals).toFixed(1)} bar` : '—';
}
function tempLabel(p) {
  const t2 = NSXCore.resolveProfileTemp(p?.profile);
  return t2 != null ? fmtTemp(t2) : '—';
}

// Which frame (0-based) is highlighted on the plot — cleared whenever the
// selected profile changes, so a stale highlight can't survive onto a
// differently-shaped profile.
const selectedFrameIdx = ref(-1);
watch(selected, () => { selectedFrameIdx.value = -1; });
function toggleFrame(idx) {
  selectedFrameIdx.value = selectedFrameIdx.value === idx ? -1 : idx;
}

function stages(p) {
  return frames(p).map((f, i) => ({
    idx: i,
    name: frameName(f, i, t),
    detail: frameDetailText(f, t),
  }));
}

// The "preset" spark — no ticks/stage-labels/built-in legend (the detail pane
// draws its own legend via .glabel below) and no temperature line (pressure +
// flow only, per how the legend reads). Used only in the detail pane; list
// rows are plain text, and this used to be the small list-row thumbnail
// before it moved here. compactMargins stretches the chart to the full width
// of its container instead of letterboxing to the native 680x274 aspect ratio.
function plotSvg(p, frameIdx = -1) {
  return NSXCore.renderProfileSpark(p?.profile, {
    // The renderer paints its own background, and its whole palette turns on
    // this one option — it was pinned to 'dark', so on the light theme the
    // plot arrived as a dark grey slab with dark-theme grid and tick colours
    // on a white card. Reading skinSettings here also makes the SVG re-render
    // when the theme is switched, since this runs from the template.
    theme: skinSettings.theme === 'light' ? 'light' : 'dark', showLegend: false, showXTicks: false, showYTicks: false, showStageLabels: false,
    showTempLine: false, compactMargins: true, selectedFrameIdx: frameIdx, pressureMax: 12,
  });
}

function confirmSelect() {
  if (selected.value) emit('select', selected.value);
}

// ── Library create/edit (mode="manage" only) ────────────────────────────
const showEditor = ref(false);
const editingRecord = ref(null); // null = new profile
// Set only while editingRecord holds a synthetic "seeded from X" stand-in
// (see startFromPreset) — the id of the real record that seeded it, tracked
// separately from editingRecord.id so onEditorSaved can tell "editing record
// X in place" apart from "starting a NEW record that happens to look like X".
const presetSourceId = ref(null);

// Tapping "+ New" no longer jumps straight into a blank editor — it asks
// blank vs. from an existing profile first. Editing a default copies it too
// (see openEditProfile), but the two are different intents: this one starts
// from a profile and expects a new one; that one starts from a profile you
// wanted to change and discovers it cannot be changed.
async function newProfileChoice() {
  const v = await openChooser({
    title: t('profilePicker.newProfileChoiceTitle'),
    options: [['blank', t('profilePicker.newBlank')], ['preset', t('profilePicker.fromPreset')]],
    current: 'blank',
  });
  if (v === 'blank') openNewProfile();
  else if (v === 'preset') pickingSource.value = true;
}
function openNewProfile() {
  editingRecord.value = null;
  presetSourceId.value = null;
  showEditor.value = true;
}
// "From preset" step 2: browsing the list already IS profile selection here,
// so reuse it — pickingSource just swaps the detail pane's action row (see
// template) to a single "Use as starting point" button instead of the normal
// Delete/Hide/Edit ones.
const pickingSource = ref(false);
function useSelectedAsPreset() {
  const record = selected.value;
  if (!record) return;
  presetSourceId.value = record.id;
  // Author is reset — the new profile is ours, not the source's — but title/
  // notes/steps/limits carry over as the actual starting point. isDefault:
  // false here is just "this synthetic record isn't a real default row";
  // onEditorSaved decides the save path from presetSourceId, not this flag.
  editingRecord.value = { id: null, isDefault: false, profile: { ...record.profile, author: '' } };
  pickingSource.value = false;
  showEditor.value = true;
}
function openEditProfile() {
  // A Decent default opens here too. It is never edited in place — the editor
  // says so (its Save reads "Save copy") and saveLibraryProfile forks it,
  // leaving the original alone — but "open it, change something, keep it" is
  // what people mean by Edit, and refusing to open it only made them hunt for
  // "New -> From preset" to do the same thing.
  if (!selected.value) return;
  editingRecord.value = selected.value;
  presetSourceId.value = null;
  showEditor.value = true;
}

// Save-branch logic (New/Edit here, and EspressoView's per-recipe "Edit
// profile") lives in useCore.js's saveLibraryProfile — see its docstring.
async function onEditorSaved({ profile: built, originalProfile }) {
  const record = editingRecord.value;
  const fromPreset = presetSourceId.value != null;

  try {
    const savedRecord = await saveLibraryProfile({
      record, built, originalProfile, fromPreset, presetSourceId: presetSourceId.value,
    });
    if (hiddenLoaded.value) await refreshProfilesAll(true);

    // Land on the saved profile — always user-owned now, even if it started
    // as a Decent copy, so the Custom tab is where it actually lives.
    activeGroup.value = 'user';
    selectedId.value = savedRecord?.id ?? null;
  } catch (err) {
    // Nothing was created, so there is nothing to land on — keep the editor
    // open with the user's work in it and say what has to change.
    if (err?.name === 'ProfileSaveRefused') {
      showToast(t(`profileEditor.refused_${err.reason}`));
      return;
    }
    console.error('[Nova] failed to save profile', err?.message);
    showToast(t('profileEditor.saveFailed'));
  }
  showEditor.value = false;
  editingRecord.value = null;
  presetSourceId.value = null;
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="onBackTap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <!-- `selected` is passed to the slot so a wizard's progress trail can fill
           its Profile bubble the moment one is highlighted, rather than only
           after the confirm button — the highlight IS the choice; the button
           just commits it. -->
      <slot name="crumbs" :selected="selected"><span class="ov-title">{{ mode === 'manage' ? t('profilePicker.manageTitle') : t('profilePicker.pickTitle') }}</span></slot>
      <button
        class="sort-btn lg icon-only"
        :aria-pressed="showHidden"
        :aria-label="showHidden ? t('profilePicker.hideHidden') : t('profilePicker.showHidden')"
        @click="toggleShowHidden"
      >
        <svg v-if="showHidden" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6 0 10 7 10 7a17.3 17.3 0 0 1-3.2 4.1M6.5 6.6C3.6 8.4 2 12 2 12s4 7 10 7c1.4 0 2.7-.4 3.9-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
      </button>
      <button v-if="mode === 'manage'" class="sort-btn lg" @click="newProfileChoice">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        {{ t('profilePicker.newProfile') }}
      </button>
    </div>

    <div class="pick-body">
      <div class="pick-list" v-show="showList">
        <div v-if="pickingSource" class="picking-banner">
          <span>{{ t('profilePicker.pickingSourceHint') }}</span>
          <button class="btn" @click="pickingSource = false">{{ t('common.cancel') }}</button>
        </div>
        <!-- Above the tabs, because it belongs to neither of them: these are
             the profiles you have actually been brewing, wherever they live.
             A hairline under them, then the library as it was. -->
        <div v-if="recentProfiles.length" class="pick-recent">
          <span class="pick-group-label">{{ t('common.recent') }}</span>
          <button
            v-for="p in recentProfiles"
            :key="`recent-${p.id}`"
            class="pick-item"
            :class="{ sel: p.id === selectedId }"
            @click="selectedId = p.id"
          >
            <span class="pname">{{ p.profile?.title || '—' }}</span>
            <span v-if="p.profile?.title === currentTitle" class="cur">{{ t('common.current') }}</span>
          </button>
        </div>
        <span v-if="recentProfiles.length" class="pick-group-label">{{ t('common.library') }}</span>
        <div class="seg seg-tall" :data-pos="activeGroup === 'user' ? 1 : 0">
          <span class="seg-thumb"></span>
          <button :class="{ on: activeGroup === 'decent' }" @click="activeGroup = 'decent'">{{ t('profilePicker.decentProfiles') }}</button>
          <button :class="{ on: activeGroup === 'user' }" @click="activeGroup = 'user'">{{ t('profilePicker.myProfiles') }}</button>
        </div>

        <div class="pick-type-filter">
          <div class="pe-type-grid pick-type-row">
            <button class="type-small" :class="{ on: activeType === 'all' }" @click="activeType = 'all'">{{ t('profilePicker.allTypes') }}</button>
            <button
              v-for="ty in SMALL_TYPES"
              :key="ty"
              class="type-small"
              :class="{ on: activeType === ty }"
              @click="activeType = ty"
            >{{ t(`profileEditor.beverageTypes.${ty}`) }}</button>
          </div>
          <div class="pe-type-grid pick-type-row">
            <button
              v-for="ty in BIG_TYPES"
              :key="ty"
              class="type-big"
              :class="{ on: activeType === ty }"
              @click="activeType = ty"
            >{{ t(`profileEditor.beverageTypes.${ty}`) }}</button>
          </div>
        </div>

        <div class="pick-items">
          <template v-for="e in entries" :key="e.id">
            <span v-if="e.kind === 'group'" class="pick-group-label">{{ e.label }}</span>
            <button
              v-else
              class="pick-item"
              :class="{ sel: e.profile.id === selectedId, grouped: e.grouped, 'is-hidden': e.profile.visibility === 'hidden' }"
              @click="selectedId = e.profile.id"
            >
              <span class="pname">{{ e.grouped ? '– ' : '' }}{{ e.name }}</span>
              <span v-if="e.profile.profile?.title === currentTitle" class="cur">{{ t('common.current') }}</span>
            </button>
          </template>
          <div v-if="!entries.length" class="pick-empty">{{ t('profilePicker.noneInGroup') }}</div>
        </div>
      </div>

      <div v-if="selected" class="pick-detail">
        <div class="pick-plot" v-html="plotSvg(selected, selectedFrameIdx)"></div>
        <div class="glabel">
          <i><span class="sw" style="background: #17c29a"></span>{{ t('profilePicker.legPressure') }}</i>
          <i><span class="sw" style="background: #7aaaff"></span>{{ t('profilePicker.legFlow') }}</i>
        </div>

        <div class="pd-split">
          <div class="pd-stages">
            <span class="pd-panel-label">{{ t('profilePicker.stages') }}</span>
            <div class="pd-stages-list">
              <button
                v-for="s in stages(selected)"
                :key="s.idx"
                class="pd-stage"
                :class="{ sel: s.idx === selectedFrameIdx }"
                @click="toggleFrame(s.idx)"
              >
                <span class="pd-stage-idx">{{ s.idx + 1 }}</span>
                <div class="pd-stage-main">
                  <span class="pd-stage-name">{{ s.name }}</span>
                  <span class="pd-stage-detail">{{ s.detail }}</span>
                </div>
              </button>
            </div>
          </div>

          <div class="pd-text">
            <div class="pd-title">{{ selected.profile?.title || t('profilePicker.unnamed') }}</div>
            <div v-if="selected.profile?.author" class="pd-author">{{ t('profilePicker.by') }} {{ selected.profile.author }}</div>
            <div class="pd-meta">
              <span>{{ t('profilePicker.peak') }} <b>{{ peakPressure(selected) }}</b></span>
              <span>{{ t('profilePicker.temp') }} <b>{{ tempLabel(selected) }}</b></span>
            </div>
            <p class="pd-desc">{{ selected.profile?.notes || t('profilePicker.noNotes') }}</p>
          </div>
        </div>

        <div class="pd-actions">
          <template v-if="mode === 'manage' && pickingSource">
            <button class="btn accent" @click="useSelectedAsPreset">{{ t('profilePicker.useAsStart') }}</button>
          </template>
          <template v-else-if="mode === 'manage'">
            <button v-if="isUserOwned(selected)" class="btn danger" @click="deleteSelected">{{ t('common.delete') }}</button>
            <button class="btn" @click="toggleSelectedVisibility">
              {{ selected.visibility === 'hidden' ? t('profilePicker.unhide') : t('profilePicker.hide') }}
            </button>
            <!-- Shown for a Decent default too: saving one creates your copy
                 and leaves the original where it is (saveLibraryProfile), and
                 the editor says as much before you press Save. -->
            <button class="btn accent" @click="openEditProfile">{{ t('common.edit') }}</button>
          </template>
          <!-- The caller names this: inside the new-recipe wizard the press
               creates the recipe, and "Select profile" would understate what
               happens next. -->
          <button v-if="mode === 'pick'" class="btn accent" @click="confirmSelect">{{ props.confirmLabel || t('profilePicker.select') }}</button>
        </div>
      </div>
    </div>

    <PageTransition>
      <ProfileEditor
        v-if="showEditor"
        :record="editingRecord"
        @close="showEditor = false; editingRecord = null"
        @saved="onEditorSaved"
      />
    </PageTransition>
  </div>
</template>
