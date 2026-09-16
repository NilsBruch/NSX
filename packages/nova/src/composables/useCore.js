/**
 * The bridge between NSXCore (plain event emitter on `window`) and Vue reactivity.
 *
 * Everything pure — presets, recipes, shot/workflow mapping, machine state, CRUD —
 * lives in NSXCore (see packages/core/README.md). This module owns no business
 * logic; it mirrors core events into a reactive object the views render from, and
 * runs the prescribed bootstrap sequence.
 *
 * Subscriptions happen at module load, before any await, because api.js already has
 * the WebSockets open and messages may be arriving.
 */
import { computed, reactive, ref } from 'vue';
import i18n from '../i18n/index.js';
import { openAlert } from './useModals.js';

const { NSXCore, NSXApi } = window;

/** Live machine/device state. Written only by the handlers below. */
export const machine = reactive({
  state: 'sleeping',
  substate: null,
  connected: false,
  scaleConnected: false,
  weight: 0,
  weightFlow: null,
  water: { currentLevel: null, refillLevel: null },
  timeToReadyMs: null,
});

/** Skin bootstrap status, so views can show a loading/disconnected state. */
export const boot = reactive({ done: false, error: null });

/**
 * The raw gateway workflow object (as fetched via NSXApi.fetchCurrentWorkflow /
 * pushed back via NSXCore.buildGatewayPayload) — the shape workflow.js and
 * mapping.js operate on. useRecipe.js derives its editable view from this;
 * anything that changes the loaded recipe (recipe picker, push after an edit)
 * updates this ref so every consumer stays in sync.
 */
export const currentWorkflow = ref(null);

/**
 * The RECENT-SHOTS REFERENCE LIST: newest ~200 shots, never filtered, never
 * paged. Deliberately one fixed query, because everything reading it wants the
 * same thing — "what has been brewed lately" — regardless of what the user is
 * searching for elsewhere: the Diary's per-bean shot counts, the recipe list's
 * "last brewed" sort, Espresso's history button, post-shot matching.
 *
 * NOT a core cache (shot.js only caches per-id detail; no skin-agnostic
 * full-list cache exists, because "how much to page/filter" is skin-shaped).
 * Nova keeps its own here so those consumers share one fetch.
 *
 * Anything that needs a DIFFERENT query — a search, a bean's whole history, a
 * paged history browse — owns its own ref rather than writing this one. See
 * useDiary.js's `historyPage` and `beanShots`. That separation is load-bearing:
 * while this ref doubled as the full-history search buffer, one search left
 * every other consumer reading the filtered result, so most beans showed 0
 * shots until the next reload.
 */
export const shots = ref([]);

/** Normalise fetchShots' response, which is either a bare array or {items,total}. */
export function shotsFromResponse(res) {
  const items = Array.isArray(res) ? res : (res?.items ?? []);
  const total = Array.isArray(res) ? items.length : (res?.total ?? items.length);
  return { items, total };
}

/** Refresh the reference list. No offset/search parameters by design — see above. */
export async function loadShots(limit = 200) {
  shots.value = shotsFromResponse(await NSXApi.fetchShots(limit)).items;
  return shots.value;
}

/**
 * Beans and grinders ARE cached in core (bean.js/grinder.js), but that cache is a
 * plain array behind a sync getter, not something Vue can track. These refs mirror
 * it into reactivity via the domains' *Loaded events, so any view can just read
 * `beans.value`/`grinders.value` and re-render when NSXCore.loadBeans()/
 * loadGrinders() runs anywhere (e.g. the Diary creating a bean updates Espresso's
 * recipe picker too, with no extra plumbing).
 */
export const beans = ref([]);
export const grinders = ref([]);
NSXCore.on('beansLoaded', ({ beans: list }) => { beans.value = list; });
NSXCore.on('grindersLoaded', ({ grinders: list }) => { grinders.value = list; });

/**
 * profile.js (unlike bean.js/grinder.js) emits no *Loaded event — it has three
 * independent caches (visible/all/deleted) with different reload semantics, so
 * there's no one "the list changed" moment to hook. Nova mirrors the visible
 * cache explicitly instead: bootCore() populates it once, and anything that
 * changes the profile library (Settings' profile manager, later) calls
 * refreshProfiles() to keep this in sync.
 */
export const profiles = ref([]);
export async function refreshProfiles(force = false) {
  profiles.value = await NSXCore.loadProfiles(force);
  return profiles.value;
}

/** The visible+hidden cache — lazily loaded (the profile picker's "show
 *  hidden" toggle calls this on first use), mirroring RecipePicker's own
 *  load-on-open convention rather than fetching it at boot. */
export const profilesAll = ref([]);
export async function refreshProfilesAll(force = false) {
  profilesAll.value = await NSXCore.loadProfilesWithHidden(force);
  return profilesAll.value;
}

/**
 * The one place a profile edit is written to the DE1 library — shared by
 * ProfilePicker.vue's manage mode (Settings) and EspressoView's per-recipe
 * "Edit profile" (which now edits the recipe's REFERENCED library profile,
 * not a copy — see useRecipe.js; that means `record` can be a Decent DEFAULT
 * here, unlike ProfilePicker's own Edit button, which hides itself for one —
 * so the isDefault guard below is load-bearing, not just defensive). Save
 * branches (the bridge derives profile ids from step content, which is why
 * an execution change can't PUT):
 *   - seeded from a preset (presetSourceId set), OR editing a Decent DEFAULT
 *     (never mutated in place, not even metadata) -> always create, linked
 *     via parentId.
 *   - new, blank (no record) -> always create, no parent.
 *   - user-owned + execution changed -> create the new version, retire the old.
 *   - user-owned + metadata only (title/author/notes) -> PUT in place, same id.
 * Returns the saved, normalized record so callers can adopt its (possibly new) id.
 * Throws ProfileSaveRefused when the gateway cannot create what was asked for —
 * see below; a caller should show that message and leave the editor open rather
 * than treat it as a failure to log.
 */
export class ProfileSaveRefused extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ProfileSaveRefused';
    this.reason = reason; // 'unchangedCopy' | 'deduped'
  }
}

export async function saveLibraryProfile({ record, built, originalProfile, fromPreset = false, presetSourceId = null }) {
  const originalId = record?.id ?? null;
  const forceNewCopy = fromPreset || record?.isDefault === true;
  // A copy exists only because its execution differs: POST /profiles is
  // content-addressed, so renaming a Decent profile without changing it hashes
  // to the original and comes back as the original (verified on a live
  // gateway). Refuse here instead of reporting a save that did nothing.
  if (forceNewCopy && NSXCore.isUnchangedProfileCopy(built, originalProfile)) {
    throw new ProfileSaveRefused('unchangedCopy');
  }

  // Every POST branch below has to prove it created something: a 201 carrying
  // an EXISTING record is how the gateway reports a content collision.
  const createdOrThrow = async (payload, avoidId) => {
    const saved = await NSXApi.createProfile(payload);
    if (NSXCore.isProfileSaveDeduped(saved, { title: built?.title, avoidId })) {
      throw new ProfileSaveRefused('deduped');
    }
    return saved;
  };

  let saved;
  if (forceNewCopy || !record) {
    saved = await createdOrThrow({
      profile: built,
      parentId: forceNewCopy ? (fromPreset ? presetSourceId : originalId) : null,
      metadata: { source: 'user' },
    }, forceNewCopy ? (fromPreset ? presetSourceId : originalId) : null);
  } else if (NSXCore.profileHasExecutionChanges(built, originalProfile)) {
    // The retire below is why this one must be guarded hardest: a deduped
    // answer here is the record we are about to delete.
    saved = await createdOrThrow({ profile: built, parentId: originalId, metadata: { source: 'user' } }, originalId);
    try { await NSXApi.deleteProfile(originalId); } catch (err) {
      console.error('[Nova] could not retire the previous profile version', err?.message);
    }
  } else {
    saved = await NSXApi.saveProfile(originalId, { profile: built, metadata: { source: 'user' } });
  }

  NSXCore.invalidateProfiles();
  NSXCore.invalidateProfilesAll();
  NSXCore.invalidateDeletedProfiles();
  await refreshProfiles(true);
  if (profilesAll.value.length) await refreshProfilesAll(true);

  return NSXCore.normalizeProfileRecord(saved);
}

/**
 * Grinder identity in the recipe title/picker (see the design log): while only
 * one grinder is configured, it is implicit and drops out — a recipe is just
 * bean + profile. Add a second grinder and it reappears automatically, no skin
 * code changes needed.
 */
export const singleGrinder = computed(() => grinders.value.length <= 1);

/** "Model (Burrs)" — the one place that decides how a grinder is named in the
 *  UI. Used by the recipe tile, the recipe cards and the grinder chooser, all
 *  of which used to spell this expression out themselves. */
export function formatGrinderLabel(g) {
  const model = g?.model || '—';
  return g?.burrs ? `${model} (${g.burrs})` : model;
}

/** A short date like "09/07/26" — locale-following (NSXI18n.getLocale()), so
 *  the digit order actually matches how the active language writes a date
 *  instead of a hardcoded DD/MM/YY that an en-US reader parses as MM/DD.
 *  Was duplicated near-verbatim in DiaryShotRow.vue, mobile/RecipeDetail.vue,
 *  mobile/tabs/DiaryTab.vue and EspressoView.vue; one home for it here. */
export function formatShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(window.NSXI18n?.getLocale?.() ?? 'en-US', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  }).format(d);
}

/**
 * The same instant split for a date RAIL — { day: '3', month: 'Sep', time:
 * '07:04' } — where formatShortDate returns one glued string. A list of shots
 * is mostly same-month, so a rail can shout the day and whisper the rest,
 * which one "09/03/26" cannot.
 *
 * Locale-following for the same reason formatShortDate is: month abbreviations
 * and 12- vs 24-hour clocks are not ours to hardcode. Intl decides both.
 */
export function formatDateParts(iso) {
  if (!iso) return { day: '—', month: '', time: '', weekday: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '—', month: '', time: '', weekday: '' };
  const locale = window.NSXI18n?.getLocale?.() ?? 'en-US';
  return {
    day: new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(d),
    month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(d),
    // 'numeric' hour, not '2-digit': a 12-hour locale renders "6:46 PM"
    // rather than "06:46 PM", and the rail is narrow enough that the two
    // characters decide whether it fits on one line.
    time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d),
    // Added for RecipeBrowser.vue's shot stepper ("Mo 14.03. | ..."); other
    // callers (DiaryShotRow, RecipeDetail) simply don't read this key.
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d),
  };
}

/**
 * A recipe's identity as dot-separated parts: roaster, bean, grinder, profile.
 * Shared by the Coffee page's title bar and the Diary's recipe rows so the two
 * can't drift — both drop parts that were never set (rather than printing "—")
 * and omit the grinder entirely when only one is configured, since it's
 * implicit then. Looked up by id, falling back to a model-name match for
 * legacy recipes saved before grinderId existed.
 */
export function recipeIdentityParts(recipe) {
  let grinderLabel = null;
  if (!singleGrinder.value) {
    const model = recipe?.grinderModel;
    if (model && model !== '—') {
      const g = grinders.value.find((x) => x.id === recipe.grinderId) ?? grinders.value.find((x) => x.model === model);
      grinderLabel = g ? formatGrinderLabel(g) : model;
    }
  }
  return [recipe?.coffeeRoaster, recipe?.coffeeName, grinderLabel, recipe?.profileTitle]
    .filter((v) => v && v !== '—');
}

NSXCore.on('machineState', ({ state, substate }) => {
  const prev = machine.state;
  machine.state = state;
  machine.substate = substate ?? null;
  // machine.js keeps the authoritative cache that canExecuteOperation() reads;
  // the skin's handler is its only writer.
  NSXCore.setMachineState(state);
  // Surface an empty water tank once, on the transition INTO needsWater — not on
  // every snapshot while it stays empty (that would re-open the popup endlessly).
  if (state === 'needsWater' && prev !== 'needsWater') {
    openAlert({
      title: i18n.global.t('alert.needsWaterTitle'),
      message: i18n.global.t('alert.needsWaterMessage'),
      confirmLabel: i18n.global.t('common.ok'),
    });
  }
});

// `machine.connected` must mean "the DE1 is actually there", which is BOTH:
//   - the gateway is reachable (the 'machineConnected' event = the machine
//     snapshot WS being open), AND
//   - the DE1 device is connected (the devices WS reports a connected machine).
// The snapshot WS stays open even after the DE1 disconnects from the gateway,
// so that signal ALONE leaves the status island stuck on the last state
// ("ready") after a disconnect — the devices WS is what actually flips. AND-ing
// them also covers the gateway going away entirely (snapshot WS closes → false).
let gatewayReachable = false;
let de1DeviceConnected = false;
const refreshMachineConnected = () => { machine.connected = gatewayReachable && de1DeviceConnected; };
NSXCore.on('machineConnected', (connected) => { gatewayReachable = !!connected; refreshMachineConnected(); });
NSXCore.on('devices', (payload) => { de1DeviceConnected = !!payload?.machineConnected; refreshMachineConnected(); });
NSXCore.on('scaleConnected', (connected) => { machine.scaleConnected = !!connected; });

NSXCore.on('scaleWeight', ({ weight, weightFlow }) => {
  machine.weight = weight;
  machine.weightFlow = weightFlow ?? null;
});

NSXCore.on('waterLevel', ({ currentLevel, refillLevel }) => {
  machine.water.currentLevel = currentLevel;
  machine.water.refillLevel = refillLevel;
});

NSXCore.on('timeToReady', ({ remainingMs }) => { machine.timeToReadyMs = remainingMs ?? null; });

/**
 * The raw machine snapshot (pressure/flow/temperature "as of right now") that
 * drives the live shot graph. NOT the same stream as `machineState` above —
 * this is the higher-frequency "liveShot" event (bridged from gateway:snapshot).
 */
export const liveShot = reactive({
  pressure: 0, targetPressure: 0, flow: 0, targetFlow: 0,
  groupTemperature: 0, targetGroupTemperature: 0, profileFrame: 0,
  steamTemperature: 0,
});
// NOTE: the live /ws/v1/machine/snapshot stream is a MachineSnapshot — flat
// machine readings only. It carries NO volume and NO scale weight (verified
// against the real gateway, even mid-shot). Volume lives on the composite
// ShotSnapshot, which the gateway only assembles + persists into a finished
// shot's measurements[] — there is no live ShotSnapshot stream. So live volume
// must be integrated from `flow` here in the skin (see SimpleLiveOverlay).
NSXCore.on('liveShot', (snap) => {
  liveShot.pressure = snap?.pressure ?? 0;
  liveShot.targetPressure = snap?.targetPressure ?? 0;
  liveShot.flow = snap?.flow ?? 0;
  liveShot.targetFlow = snap?.targetFlow ?? 0;
  liveShot.groupTemperature = snap?.groupTemperature ?? 0;
  liveShot.targetGroupTemperature = snap?.targetGroupTemperature ?? 0;
  liveShot.profileFrame = snap?.profileFrame ?? 0;
  // Real steam-boiler temperature from the machine snapshot (same field NSX
  // reads for its steam orb). 0/absent when the machine isn't reporting it.
  liveShot.steamTemperature = snap?.steamTemperature ?? 0;
});

/** Startup sequence, in the order the core README prescribes. */
export async function bootCore() {
  try {
    await NSXCore.migrateLegacyStore();
    await NSXCore.loadStore();

    NSXCore.hydrateSteam();
    NSXCore.hydrateHotwater();
    NSXCore.hydrateFlush();
    NSXCore.hydrateSchedule();

    // A machine can be offline while the tablet is not — a failed fetch must not
    // stop the skin from rendering, so these are settled, not awaited as a unit.
    const [, workflowResult] = await Promise.allSettled([
      NSXApi.fetchMachineInfo(),
      NSXApi.fetchCurrentWorkflow(),
      refreshProfiles(),
      NSXCore.loadBeans(),
      NSXCore.loadGrinders(),
      NSXCore.loadRecipes(),
      loadShots(200),
    ]);
    if (workflowResult.status === 'fulfilled') currentWorkflow.value = workflowResult.value;

    // Seed the schedule id if one already exists on the gateway (first launch
    // on a machine that already has a schedule from a previous skin/session).
    try {
      const schedules = await NSXApi.fetchSchedules();
      const existing = Array.isArray(schedules) ? schedules[0] : schedules?.items?.[0];
      if (existing?.id && !NSXCore.getScheduleState().scheduleId) {
        NSXCore.setScheduleId(existing.id);
      }
    } catch (err) {
      console.warn('[Nova] could not fetch schedules on startup', err?.message);
    }
  } catch (err) {
    console.error('[Nova] core bootstrap failed', err);
    boot.error = err;
  } finally {
    boot.done = true;
  }
}

export function useMachine() {
  return machine;
}
