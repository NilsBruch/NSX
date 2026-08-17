/**
 * The current recipe as an editable view over NSXCore's raw "workflow" shape
 * (see packages/core/src/domains/workflow.js's buildGatewayPayload / mapping.js's
 * mapApiWorkflowToDisplay). A recipe = bean + profile (+ grinder, once more than
 * one is configured — see GRINDERS in useGrinders.js).
 *
 * Recipes are real persisted entities the user builds (workflow.js's recipe
 * store: loadRecipes/saveRecipes/makeRecipeId — a gateway-store-backed list,
 * 3-way merged on write), not a list conjured from shot history. `recipe.id`
 * tracks which persisted entity (if any) is currently loaded: set by
 * selectRecipe()/createRecipeFromCurrent(), left null for a workflow the
 * gateway happens to be running that was never loaded through the picker in
 * this session. Editing dose/grind/yield/temp/profile while a recipe.id is
 * set updates that SAME persisted entity (see persistCurrentRecipeEdits,
 * called from pushRecipe) — the same "loaded recipe stays the same recipe"
 * behavior NSX's workflowItems[selectedWorkflowIndex] has.
 *
 * ── The bean / bag invariant ───────────────────────────────────────────────
 * Every workflow that reaches the gateway carries a real bean and a real batch
 * (a *bag*: one bean + one roast date — see bean.js's resolveBatch). That is
 * upheld in exactly one place: ensureRecipeBatch(), called from pushRecipe(),
 * which is the single choke point every workflow passes through. It matters
 * because the batch is the ONLY structural link a shot has back to its bean
 * (shot.workflow.context.beanBatchId -> batch.beanId -> bean); without it the
 * Diary can only guess the bean by roaster/name string matching.
 *
 * Roast date is deliberately NOT a bean field: a bean's roaster/origin/process
 * are permanent, what changes is which bag you're pulling from. It lives on the
 * batch — and a batch's roast date is IMMUTABLE. Setting a new roast date
 * resolves the recipe to a DIFFERENT bag (see setRoastDate); it never rewrites
 * the old one, which would retroactively change the roast date every past shot
 * on that bag reports. The bean itself is managed in the Diary.
 */
import { reactive, computed, ref, watch } from 'vue';
import { currentWorkflow, machine, grinders } from './useCore.js';

const { NSXCore, NSXApi } = window;

export const recipe = reactive({
  id: null, // persisted recipe id, or null if not (yet) loaded from the library
  coffeeRoaster: '—',
  coffeeName: '—',
  grinderModel: '—',
  grinderSetting: '—',
  targetDoseWeight: 0,
  targetYield: 0,
  groupTemp: 0,
  profileTitle: '—',
  selectedProfileId: null,
  // The recipe's OWN copy of the profile JSON — pushed embedded (see
  // NSXCore.buildGatewayPayload's fast path), never written back to the DE1
  // profile library. This is what lets the same base profile (e.g. Londinium)
  // diverge slightly per recipe without spawning near-duplicate library
  // entries. null for legacy recipes that only ever carried a reference
  // (selectedProfileId/profileTitle); those still resolve via the library.
  profile: null,
  // Auto-stop the shot at the target?  ON + scale -> stop at weight (targetYield);
  // ON + no scale -> stop at volume (targetYield * calibration factor);
  // OFF -> no auto-stop, the user stops manually. See NSXCore.buildGatewayPayload.
  stopAtWeight: true,
  grinderId: null,
  beanId: null,      // resolved from coffeeRoaster+coffeeName (see ensureRecipeBatch)
  beanBatchId: null, // the bag: (beanId, roastDate) — never one per shot
  roastDate: null,   // ISO date string, or null = "not set". Derived from the batch,
                     // which is the source of truth; deliberately NOT persisted on the recipe.
  // ml-per-gram factor this recipe has learned for estimating weight from the
  // DE1's own volume tracking when no physical scale is connected — see
  // NSXCore.updateVolumeCalibration (mapping.js) and useLiveShot.js's
  // post-shot hook, which is what actually refines this after each brew.
  volumeCalibration: { factor: 1.0, samples: [] },
  // The user's own 0–5 star rating of THIS recipe (half steps allowed), set via
  // the "Rate" button on the Espresso screen. 0 = unrated.
  rating: 0,
});

/** The persisted recipe library — the recipe picker's real list, not a
 *  history-derived one. Lazily loaded (RecipePicker.vue calls this on open),
 *  matching every other lazily-loaded panel's own load-on-open convention. */
export const recipes = ref([]);
export async function refreshRecipes() {
  recipes.value = await NSXCore.loadRecipes();
  return recipes.value;
}

/** Deep-copies a profile JSON so a recipe's embedded copy never aliases the
 *  library record (or another recipe's copy) it was picked from — see the
 *  `recipe.profile` field note above. */
export function cloneProfile(p) {
  if (!p || typeof p !== 'object') return null;
  try { return structuredClone(p); } catch { return JSON.parse(JSON.stringify(p)); }
}

function hasFrames(p) {
  const frames = p?.steps ?? p?.frames;
  return Array.isArray(frames) && frames.length > 0;
}

function snapshotFromCurrentRecipe(existing = {}) {
  return {
    ...existing,
    id: recipe.id,
    coffeeRoaster: recipe.coffeeRoaster,
    coffeeName: recipe.coffeeName,
    grinderModel: recipe.grinderModel,
    grinderSetting: recipe.grinderSetting,
    targetDoseWeight: recipe.targetDoseWeight,
    targetYield: recipe.targetYield,
    groupTemp: recipe.groupTemp,
    profileTitle: recipe.profileTitle,
    selectedProfileId: recipe.selectedProfileId,
    profile: recipe.profile,
    stopAtWeight: recipe.stopAtWeight,
    grinderId: recipe.grinderId,
    beanId: recipe.beanId,
    beanBatchId: recipe.beanBatchId,
    volumeCalibration: recipe.volumeCalibration,
    rating: Number(recipe.rating) || 0,
  };
}

/** Writes the current dial values back into the loaded recipe's persisted
 *  entry — a no-op if nothing is loaded (recipe.id is null). */
async function persistCurrentRecipeEdits() {
  if (!recipe.id) return;
  const idx = recipes.value.findIndex((r) => r.id === recipe.id);
  if (idx < 0) return;
  const snapshot = snapshotFromCurrentRecipe(recipes.value[idx]);
  const updated = recipes.value.map((r, i) => (i === idx ? snapshot : r));
  recipes.value = await NSXCore.saveRecipes(updated);
}

/** Set the user's 0–5 star rating for the loaded recipe (half steps) and persist
 *  it. No-op with nothing loaded; if the recipe isn't saved yet the value still
 *  lives on `recipe` and is written out when it's first saved. */
export async function setRecipeRating(value) {
  recipe.rating = Math.max(0, Math.min(5, Number(value) || 0));
  await persistCurrentRecipeEdits();
}

/** Applied by useLiveShot.js's post-shot hook once the calibration feedback
 *  loop (NSXCore.updateVolumeCalibration) has computed a refined factor for
 *  the recipe that was just brewed. */
export async function saveVolumeCalibration(cal) {
  recipe.volumeCalibration = cal;
  await persistCurrentRecipeEdits();
}

/** Persists the current dial values as a brand-new recipe entity and loads
 *  it (recipe.id now points at it) — the "+ New recipe" flow's save step. */
export async function createRecipeFromCurrent() {
  recipe.id = NSXCore.makeRecipeId();
  const entry = snapshotFromCurrentRecipe({ lastUsed: Date.now() });
  recipes.value = await NSXCore.saveRecipes([...recipes.value, entry]);
  return entry;
}

export async function deleteRecipe(id) {
  recipes.value = await NSXCore.saveRecipes(recipes.value.filter((r) => r.id !== id));
  if (recipe.id === id) recipe.id = null;
}

/** Bumps a recipe's lastUsed on an actual completed shot — matches NSX's real
 *  trigger exactly (selecting a recipe does NOT touch lastUsed; only a shot
 *  finishing does). Called from useLiveShot.js's finishLive(). */
export async function bumpRecipeLastUsed(id) {
  if (!id) return;
  const idx = recipes.value.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const updated = recipes.value.map((r, i) => (i === idx ? { ...r, lastUsed: Date.now() } : r));
  recipes.value = await NSXCore.saveRecipes(updated);
}

export const roastAge = computed(() => NSXCore.getBatchAge(recipe.roastDate));

/**
 * Upholds the bean/bag invariant: after this, the recipe has a real beanId and
 * a real beanBatchId. Called from pushRecipe(), the single choke point every
 * workflow passes through on its way to the gateway — so "every workflow has a
 * bag" is true by construction rather than by remembering to call this in each
 * of the half-dozen places that can change a recipe.
 *
 * Fast path first: pushRecipe() runs on EVERY dial edit, so an already-resolved
 * recipe must cost zero network.
 */
async function ensureRecipeBatch() {
  if (recipe.beanBatchId && recipe.beanId) return;

  const roaster = recipe.coffeeRoaster;
  const name = recipe.coffeeName;
  // A placeholder recipe (nothing picked yet) has no coffee to hang a bag off.
  if (!roaster || roaster === '—' || !name || name === '—') return;

  try {
    if (!recipe.beanId) {
      const bean = await NSXCore.resolveBean(roaster, name);
      if (!bean?.id) return;
      recipe.beanId = bean.id;
    }

    const batch = await NSXCore.resolveBatch(recipe.beanId, recipe.roastDate);
    recipe.beanBatchId = batch?.id ?? null;
    // The batch is the source of truth for the date — adopt whatever it holds
    // (an existing bag may already have one even if this recipe didn't know it).
    recipe.roastDate = batch?.roastDate ?? recipe.roastDate ?? null;
  } catch (err) {
    // A gateway hiccup here must not block the shot the user is about to pull:
    // push the workflow anyway (bean-less, as before) rather than throwing.
    console.warn('[Nova] could not resolve the recipe bean/bag', err?.message);
  }
}

/**
 * Deletes the bag a recipe just moved off — but only when provably unreferenced,
 * so correcting a mistyped roast date doesn't leave a stray bag behind while a
 * genuine bag-change keeps the old one (its shots still point at it).
 *
 * Fails safe: a gateway that ignores the beanBatchId shot filter returns ALL
 * shots -> non-empty -> we don't delete. The worst case is a stray bag, never
 * an orphaned shot whose bean link we just deleted out from under it.
 */
async function gcBatchIfUnused(batchId) {
  if (!batchId || batchId === recipe.beanBatchId) return;
  if (recipes.value.some((r) => r.beanBatchId === batchId)) return;

  try {
    const res = await NSXApi.fetchShots({ beanBatchId: batchId, limit: 1 });
    const items = Array.isArray(res) ? res : (res?.items ?? []);
    if (items.length > 0) return; // the bag has history — keep it
    await NSXApi.deleteBatch(batchId);
  } catch (err) {
    console.warn('[Nova] could not clean up the previous bag', err?.message);
  }
}

async function syncFromWorkflow(wf) {
  if (!wf) return;
  const display = NSXCore.mapApiWorkflowToDisplay(wf);
  Object.assign(recipe, {
    coffeeRoaster: display.coffeeRoaster,
    coffeeName: display.coffeeName,
    grinderModel: display.grinderModel,
    grinderSetting: display.grinderSetting,
    targetDoseWeight: display.targetDoseWeight,
    // A pushed workflow carries context.targetYield 0 when stop-at-weight is off
    // (manual stop) — that's a real gateway value but never a meaningful display
    // one (you don't brew to 0 g), so keep the dialed yield rather than blanking
    // the UI to 0 on the self-push round-trip.
    targetYield: display.targetYield > 0 ? display.targetYield : recipe.targetYield,
    groupTemp: NSXCore.resolveProfileTemp(wf?.profile) ?? 0,
    profileTitle: display.profileTitle,
    selectedProfileId: wf?.profileId ?? null,
    // Seed the embedded copy ONLY if this recipe doesn't already own one — the
    // gateway workflow is the resolved, temp-adjusted PUSH payload (it may also
    // carry target_weight/target_volume baked in for that push's scale state),
    // so re-adopting it on every self-push echo would overwrite an already-
    // divergent recipe.profile with stale computed fields. This path exists
    // purely to give a recipe adopted from the machine at boot (which has no
    // embedded copy yet) a real starting profile.
    profile: recipe.profile ?? (hasFrames(wf?.profile) ? cloneProfile(wf.profile) : null),
    // stopAtWeight isn't recoverable from a pushed gateway workflow — keep
    // whatever the recipe already has (defaults to true) rather than guessing.
    grinderId: wf?.context?.grinderId ?? null,
    beanId: null,
    beanBatchId: wf?.context?.beanBatchId ?? null,
    roastDate: null,
  });
  await adoptBatch(recipe.beanBatchId);
}

/** Reads roastDate + beanId back off a batch the recipe already references.
 *  The batch carries the real beanId FK, so this is also how a recipe loaded
 *  from the gateway (which only stores beanBatchId) learns which bean it is. */
async function adoptBatch(batchId) {
  if (!batchId) return;
  try {
    const batch = await NSXApi.fetchBatch(batchId);
    recipe.roastDate = batch?.roastDate ?? null;
    recipe.beanId = batch?.beanId ?? recipe.beanId ?? null;
  } catch {
    // The bag may have been deleted independently (e.g. archived on another
    // device). Drop the dangling reference so ensureRecipeBatch re-resolves a
    // real one on the next push, rather than pushing a broken FK.
    recipe.beanBatchId = null;
  }
}

export async function refreshFromWorkflow() {
  await syncFromWorkflow(currentWorkflow.value);
}

// Espresso mounts before bootCore()'s fetchCurrentWorkflow() necessarily resolves
// (it's the default route), so `recipe` must react whenever currentWorkflow later
// changes — not just when a view happens to call refreshFromWorkflow() itself.
// selectRecipe()/composeNewRecipe() also assign `recipe` fields directly before
// this fires; syncFromWorkflow is idempotent, so the watcher re-running is harmless.
watch(currentWorkflow, (wf) => { syncFromWorkflow(wf); });

// ── Deferred push (machine can't accept a workflow: asleep / heating / busy) ─
// setWorkflow is only legal in certain states (machine.js ALLOWED_OPERATIONS).
// A user edit made outside them is held here and auto-flushed the moment the
// machine can take one again (the machineState handler below). The pending
// recipe id is ALSO persisted (nova_pending_push) so a reload before the
// machine wakes doesn't silently drop the edit — adoptCurrentWorkflowAsRecipe
// re-applies the saved recipe on boot.
const PENDING_PUSH_KEY = 'nova_pending_push';
let pendingPush = false;
function markPendingPush() {
  pendingPush = true;
  if (recipe.id) NSXCore.patchStore({ [PENDING_PUSH_KEY]: recipe.id });
}
function clearPendingPush() {
  pendingPush = false;
  // deleteStore (not patchStore null): the gateway store 500s on a null POST.
  if (NSXCore.getStore()[PENDING_PUSH_KEY]) NSXCore.deleteStore(PENDING_PUSH_KEY);
}

/** Builds the gateway payload from the current edits and pushes it.
 *  Guarded the same way NSX's own pushSelectedWorkflowToMachine is: setWorkflow
 *  is only legal in 'idle' (see machine.js's ALLOWED_OPERATIONS) — without this,
 *  editing dose/grind/profile while e.g. heating or mid-maintenance would push
 *  a workflow change racing whatever the machine is actually doing. */
export async function pushRecipe({ silent = false } = {}) {
  if (!NSXCore.canExecuteOperation('setWorkflow')) {
    // The machine can't accept a workflow right now (asleep / heating / mid-op).
    // For a real user edit: persist it so a reload can't lose it (C), queue it
    // to auto-push once the machine allows it (A — see the machineState handler),
    // and say so. `silent` pushes are boot-time healing the user didn't ask for
    // — no toast, no queue (the next real edit re-queues, and boot re-heals).
    if (!silent) {
      await persistCurrentRecipeEdits();
      markPendingPush();
      const t = window.NSXI18n?.t || ((k) => k);
      NSXCore.emit('toast', t('toast.recipeQueued'));
    }
    return;
  }
  // The invariant: no workflow leaves here without a real bean + bag behind it.
  await ensureRecipeBatch();

  const workflowForPayload = {
    coffeeRoaster: recipe.coffeeRoaster,
    coffeeName: recipe.coffeeName,
    grinderModel: recipe.grinderModel,
    grinderSetting: recipe.grinderSetting,
    targetDoseWeight: recipe.targetDoseWeight,
    targetYield: recipe.targetYield,
    groupTemp: recipe.groupTemp,
    profileTitle: recipe.profileTitle,
    selectedProfileId: recipe.selectedProfileId,
    // Present -> buildGatewayPayload's embedded fast path (no library lookup);
    // absent -> falls back to resolving selectedProfileId/profileTitle, as before.
    profile: recipe.profile,
    stopAtWeight: recipe.stopAtWeight,
    // Needed for the no-scale volume stop: target_volume = targetYield * factor.
    volumeCalibration: recipe.volumeCalibration,
    grinderId: recipe.grinderId,
    beanBatchId: recipe.beanBatchId,
  };
  const payload = await NSXCore.buildGatewayPayload(workflowForPayload, {
    scaleConnected: machine.scaleConnected,
  });
  if (!payload) throw new Error('Could not resolve a profile to push (frameless or missing)');
  await NSXApi.pushWorkflow(payload);
  currentWorkflow.value = payload; // what we sent is now what the gateway holds
  _lastPushedScale = machine.scaleConnected; // the scale state this payload's stop-mode was built for
  await persistCurrentRecipeEdits();
  clearPendingPush(); // this edit is now on the machine — nothing left deferred
  return payload;
}

// ── Re-push when the scale connects/disconnects ──────────────────────────────
// The stop mode baked into the pushed workflow depends on whether a scale is
// present: stopAtWeight ON + scale -> weight stop; ON + no scale -> volume stop
// (target_volume = yield * factor). See buildGatewayPayload. The machine only
// re-reads that on a push, so a scale that dies (or wakes) AFTER the recipe was
// pushed leaves the WRONG stop mode on the machine until the next dial edit —
// that's the "no scale = no volume stop" bug. Re-push on the change so the
// machine always holds the correct stop mode.
//
// Guarded by pushRecipe's own setWorkflow check (idle-only, silent = no toast /
// no deferred queue), so this NEVER pushes mid-shot and can't cut a brew short.
// A change that arrives while not idle is re-attempted on the next transition
// back to a state that can take a workflow (the machineState watch below).
let _lastPushedScale = null;   // scaleConnected value the last push's stop-mode was built for
let _scaleRepushTimer = null;
function _maybeRepushForScale() {
  clearTimeout(_scaleRepushTimer);
  // Debounced: scales flap (a quick disconnect→reconnect on wake) — settle first.
  _scaleRepushTimer = setTimeout(() => {
    if (machine.scaleConnected === _lastPushedScale) return; // machine already has the right stop mode
    if (!recipe.stopAtWeight) { _lastPushedScale = machine.scaleConnected; return; } // stop mode is scale-independent when off
    if (!recipe.id && !recipe.profile) return;               // nothing pushable loaded
    if (!NSXCore.canExecuteOperation('setWorkflow')) return;  // not idle -> wait for the idle transition below
    pushRecipe({ silent: true }).catch((err) => console.error('[Nova] scale re-push failed', err?.message || err));
  }, 800);
}
watch(() => machine.scaleConnected, _maybeRepushForScale);
// A scale change that lands mid-op is re-attempted the moment the machine is
// idle again (e.g. right after a shot the scale died during).
watch(() => machine.state, () => { if (NSXCore.canExecuteOperation('setWorkflow')) _maybeRepushForScale(); });

// Flush a deferred push the instant the machine can take one again (typically a
// wake from sleep). Reads the event's own `state` rather than the shared cache
// so it doesn't depend on useCore.js's machineState handler having run first.
NSXCore.on('machineState', ({ state }) => {
  if (!pendingPush || !NSXCore.canExecuteOperation('setWorkflow', state)) return;
  pushRecipe().catch((err) => console.error('[Nova] deferred recipe push failed', err?.message || err));
});

/**
 * Applies a freshly-edited profile (from ProfileEditor, mode="recipe") to the
 * current recipe and pushes it.
 *
 * ── Why groupTemp must be rebaselined here ──────────────────────────────
 * buildGatewayPayload shifts EVERY frame by `recipe.groupTemp -
 * resolveProfileTemp(profile)`, and resolveProfileTemp prefers profile.groupTemp
 * over any frame's own temperature. If recipe.groupTemp still held the OLD
 * baseline (from before the edit) it would silently re-shift every freshly
 * edited frame temperature again on push — e.g. edit frame 1 to 95°C and watch
 * it push as 93°C while every OTHER frame also moves by the same delta.
 * Rebaselining both the profile's own groupTemp and the recipe's dial to the
 * edited profile's natural first-frame temperature makes the delta zero, so
 * edits are literal; the dial keeps working as a bulk nudge from that new
 * baseline going forward.
 */
export async function applyEditedProfile(profile) {
  const { groupTemp: _drop, ...withoutGroupTemp } = profile;
  const naturalTemp = NSXCore.resolveProfileTemp(withoutGroupTemp) ?? recipe.groupTemp;
  profile.groupTemp = naturalTemp;
  recipe.groupTemp = naturalTemp;
  recipe.profile = profile;
  recipe.profileTitle = profile?.title || '—';
  await pushRecipe();
}

/** Loads an existing recipe entity from the library and pushes it — selecting
 *  a recipe is "load it onto the machine now", since starting the brew itself
 *  happens on the machine's own hardware. Does NOT touch lastUsed (matching
 *  NSX exactly — only a completed shot does, see bumpRecipeLastUsed). */
export async function selectRecipe(entry) {
  Object.assign(recipe, {
    id: entry.id ?? null,
    coffeeRoaster: entry.coffeeRoaster || '—',
    coffeeName: entry.coffeeName || '—',
    grinderModel: entry.grinderModel || '—',
    grinderSetting: entry.grinderSetting || '—',
    targetDoseWeight: Number(entry.targetDoseWeight) || 0,
    targetYield: Number(entry.targetYield) || 0,
    groupTemp: Number(entry.groupTemp) || 0,
    profileTitle: entry.profileTitle || '—',
    selectedProfileId: entry.selectedProfileId ?? null,
    // Legacy recipes (saved before this field existed) have none — they keep
    // resolving via the library reference (selectedProfileId/profileTitle).
    profile: cloneProfile(entry.profile),
    // Old recipes predate this field — default them to auto-stop (true).
    stopAtWeight: entry.stopAtWeight !== false,
    grinderId: entry.grinderId ?? null,
    beanId: entry.beanId ?? null,
    beanBatchId: entry.beanBatchId ?? null,
    roastDate: null,
    volumeCalibration: entry.volumeCalibration && typeof entry.volumeCalibration === 'object'
      ? entry.volumeCalibration
      : { factor: 1.0, samples: [] },
    rating: Number(entry.rating) || 0,
  });
  await adoptBatch(recipe.beanBatchId);
  await pushRecipe(); // ensureRecipeBatch heals an older, batch-less recipe here
}

/**
 * New-recipe flow (bean chosen, then a profile): dose/grind/temp keep whatever
 * was already dialed in (or the sole grinder's model, if none was set yet) —
 * only the bean+profile identity actually changes. Does not persist anything
 * itself; the caller (RecipePicker.vue) calls createRecipeFromCurrent() once
 * the user has actually picked a profile, so cancelling mid-flow saves nothing.
 *
 * `seedContext` is for the OTHER caller, loadOrCreateRecipeForBeanProfile —
 * recovering a recipe from a historic shot, where the shot's own
 * workflow.context holds the real dose/grind/yield that was actually brewed and
 * must win over whatever is currently dialed in. The plain bean-picker flow has
 * no such data, so it defaults to null and nothing changes there.
 */
export async function composeNewRecipe({ bean, profile, seedContext = null }) {
  recipe.id = null;
  Object.assign(recipe, {
    coffeeRoaster: bean.roaster || '—',
    coffeeName: bean.name || '—',
    grinderModel: seedContext?.grinderModel || (recipe.grinderModel !== '—' ? recipe.grinderModel : (grinders.value[0]?.model || '—')),
    grinderSetting: seedContext?.grinderSetting ?? recipe.grinderSetting,
    grinderId: seedContext?.grinderId ?? recipe.grinderId,
    targetDoseWeight: seedContext?.targetDoseWeight || recipe.targetDoseWeight || 18,
    targetYield: seedContext?.targetYield || recipe.targetYield || 36,
    groupTemp: NSXCore.resolveProfileTemp(profile.profile) ?? recipe.groupTemp,
    profileTitle: profile.profile?.title || '—',
    selectedProfileId: profile.id ?? null,
    // Copy, not reference: this recipe now owns its own profile JSON and can
    // diverge from the library profile it was picked from.
    profile: cloneProfile(profile.profile),
    // The bean is already a real Diary record here (BeanChooser picked it), so
    // ensureRecipeBatch only has the bag left to resolve — the bean's undated
    // one until the user sets a roast date.
    beanId: bean.id ?? null,
    beanBatchId: null,
    roastDate: null,
    volumeCalibration: { factor: 1.0, samples: [] },
    rating: 0, // a freshly composed recipe starts unrated
  });
  await pushRecipe();
}

/** Case-insensitive match on the identity a recipe carries (roaster + name +
 *  profile title). Nothing else links a bean+profile pair to a recipe — a shot
 *  has no recipe id of its own, only these strings. */
export function findRecipeForBeanProfile(bean, profileTitle) {
  const roaster = (bean?.roaster || '').trim().toLowerCase();
  const name = (bean?.name || '').trim().toLowerCase();
  const title = (profileTitle || '').trim().toLowerCase();
  if (!roaster || !name) return null;
  return recipes.value.find((r) =>
    (r.coffeeRoaster || '').trim().toLowerCase() === roaster &&
    (r.coffeeName || '').trim().toLowerCase() === name &&
    (r.profileTitle || '').trim().toLowerCase() === title
  ) ?? null;
}

/**
 * Load the recipe for this bean+profile, creating and persisting one if it
 * doesn't exist yet (the coffee was brewed some other way — another skin, or
 * before this library existed), so "what's on the machine is always a recipe in
 * your library" holds no matter how the workflow got there.
 *
 * ── Direct path: the shot's profile snapshot IS the recipe's profile ───────
 * A recipe owns its own embedded profile JSON (`recipe.profile`), and
 * buildGatewayPayload pushes that copy directly — no library lookup. So when no
 * recipe exists yet, we just clone the shot's own profile snapshot
 * (`fallbackProfile`, the real steps that were brewed) straight into the new
 * recipe. There is deliberately no resolution against the live profile library:
 *   - We don't need a library id to brew — the embedded profile is pushed as-is.
 *   - `profileTitle` / `selectedProfileId` come best-effort from the shot. If the
 *     profile has since been renamed, the recipe keeps the shot's historic title
 *     rather than the profile's current name — an accepted trade for not doing a
 *     round-trip to the bridge on every Diary tap.
 *
 * `fallbackContext` carries the shot's REAL dose/grind/yield, so the recovered
 * recipe reflects what was actually brewed instead of silently inheriting
 * whatever happened to be dialed in on the Espresso screen from an unrelated
 * recipe (composeNewRecipe's default, correct for its OTHER caller — a fresh
 * bean+profile pick, which has nothing else to seed from).
 */
export async function loadOrCreateRecipeForBeanProfile(bean, profileTitle, fallbackProfile = null, fallbackContext = null) {
  const log = (...args) => console.log('[Nova/recipe]', ...args);
  log(`tapped profile "${profileTitle}" for bean "${bean?.roaster} – ${bean?.name}"`);
  log('  shot-derived profile:', fallbackProfile
    ? `title="${fallbackProfile.title}", ${(fallbackProfile.steps ?? fallbackProfile.frames ?? []).length} steps`
    : 'NONE (no shot in this group carries a matching profile object)');
  log('  shot-derived context:', fallbackContext
    ? `dose=${fallbackContext.targetDoseWeight}g grind=${fallbackContext.grinderSetting} yield=${fallbackContext.targetYield}g`
    : 'NONE');
  log('  (both taken from the MOST RECENT shot brewed with this profile)');

  const existing = findRecipeForBeanProfile(bean, profileTitle);
  if (existing) {
    log(`  -> existing recipe found (id=${existing.id}, profileTitle="${existing.profileTitle}") — loading it`);
    await selectRecipe(existing);
    return existing;
  }
  log('  -> no existing recipe for this bean+profile; creating one from the shot snapshot');

  // The shot's own profile snapshot goes straight into the recipe (its embedded
  // profile is what buildGatewayPayload pushes — no library resolution). Without
  // steps there is nothing to brew, so this is the one hard requirement.
  if (!hasFrames(fallbackProfile)) {
    log('  -> shot carries no profile steps — cannot build a pushable recipe');
    throw new Error(`This shot carries no profile steps, so no recipe can be built for "${profileTitle}".`);
  }

  // composeNewRecipe takes a profile RECORD ({ id, profile }); wrap the raw
  // snapshot in that shape. id/title are best-effort from the shot (see docstring).
  const snapshotRecord = { id: fallbackProfile.id ?? fallbackContext?.profileId ?? null, profile: fallbackProfile };
  await composeNewRecipe({
    bean,
    profile: snapshotRecord,
    seedContext: fallbackContext,
  });
  const entry = await createRecipeFromCurrent();
  log(`  -> recipe created from snapshot: id=${entry.id}, profileTitle="${entry.profileTitle}", `
    + `selectedProfileId=${entry.selectedProfileId}, dose=${entry.targetDoseWeight}g, `
    + `grind=${entry.grinderSetting}, yield=${entry.targetYield}g`);
  return entry;
}

/**
 * Boot: make the workflow the gateway is already holding a real, saved recipe.
 *
 * Without this, a workflow the user never loaded through the picker (first
 * launch, or a coffee dialled in from another skin) leaves recipe.id null — and
 * then every dial edit persists nowhere, invisibly. Adopting it means "whatever
 * is on the machine is a recipe in your library" is true from the first frame,
 * so edits always land somewhere the user can see.
 *
 * Called from main.js after bootCore() — deliberately NOT from bootCore itself,
 * since useCore.js importing this module would close an import cycle
 * (useRecipe already imports useCore).
 */
export async function adoptCurrentWorkflowAsRecipe() {
  const wf = currentWorkflow.value;
  if (!wf) return null; // no machine / no workflow — nothing to adopt

  await refreshRecipes();
  await syncFromWorkflow(wf); // the watcher may not have run yet; this is idempotent

  const { coffeeRoaster: roaster, coffeeName: name, profileTitle } = recipe;
  if (!roaster || roaster === '—' || !name || name === '—') return null; // nothing dialled in yet

  const existing = findRecipeForBeanProfile({ roaster, name }, profileTitle);
  if (existing) {
    recipe.id = existing.id;
    // Fields the gateway workflow doesn't carry, but the saved recipe does.
    // These MUST be restored, not left at `recipe`'s defaults: the very next
    // push snapshots `recipe` wholesale (snapshotFromCurrentRecipe), so a field
    // left at its default here is silently written back over the saved value —
    // that's what used to wipe the star rating of whichever recipe happened to
    // be loaded on the machine at boot (no user edit needed; the scale re-push
    // watcher and the bag-heal push below are enough to trigger it).
    recipe.beanId = existing.beanId ?? recipe.beanId;
    if (existing.volumeCalibration) recipe.volumeCalibration = existing.volumeCalibration;
    recipe.rating = Number(existing.rating) || 0;
    recipe.stopAtWeight = existing.stopAtWeight !== false;
    // With the stop toggled OFF, the pushed workflow carries context.targetYield
    // 0 by protocol (buildGatewayPayload: that zero IS "no auto-stop"), so
    // syncFromWorkflow above fell back to `recipe.targetYield` — which on a
    // fresh load is still the reactive default 0. Only the saved recipe still
    // knows the dialed yield, so take it from there when the gateway had no
    // real value. Guarded, not unconditional: a yield genuinely changed on the
    // machine (another skin) still wins, same rule syncFromWorkflow applies.
    if (!(recipe.targetYield > 0)) recipe.targetYield = Number(existing.targetYield) || 0;

    // A push was deferred before this reload (machine still asleep then): the
    // saved recipe holds an edit the gateway never received. Re-apply the saved
    // values over the gateway-synced ones and push — flushes now if the machine
    // is awake, otherwise just re-queues (selectRecipe -> pushRecipe). A stale
    // flag (recipe since gone) self-clears on the next successful push of any recipe.
    if (NSXCore.getStore()[PENDING_PUSH_KEY] === existing.id) {
      await selectRecipe(existing);
      return recipe.id;
    }
  } else {
    await ensureRecipeBatch();
    await createRecipeFromCurrent();
  }

  // Heal the gateway's copy only if it's actually missing the bag — re-pushing
  // an already-correct workflow on every boot would be pointless churn. Silent:
  // if the machine is mid-heat this is skipped, and the next real push heals it.
  await ensureRecipeBatch();
  if (!wf?.context?.beanBatchId && recipe.beanBatchId) {
    await pushRecipe({ silent: true });
  }
  return recipe.id;
}

/**
 * A new roast date means a NEW BAG — so this re-resolves the recipe onto a
 * different batch (find-or-create for that date) instead of editing the current
 * batch's date. Editing it in place is what the old implementation did, and it
 * silently rewrote history: every past shot pulled from the old bag would
 * retroactively report the new roast date.
 *
 * The bag the recipe just left keeps its shots. If it has none — the "I mistyped
 * the date" case — gcBatchIfUnused removes it so strays don't pile up.
 */
export async function setRoastDate(iso) {
  const previousBatchId = recipe.beanBatchId;

  recipe.roastDate = iso;
  recipe.beanBatchId = null; // force ensureRecipeBatch to resolve the bag for THIS date
  await pushRecipe();        // ensureRecipeBatch runs inside, then the workflow is pushed

  await gcBatchIfUnused(previousBatchId);
}

/**
 * Swap only the BEAN of the loaded recipe, keeping everything else (dose,
 * grind, profile, rating, calibration) — the Espresso page's bean tile.
 *
 * Deliberately NOT composeNewRecipe: that sets `recipe.id = null`, i.e. it
 * detaches into a brand-new recipe. Here `recipe.id` is untouched, so
 * persistCurrentRecipeEdits (inside pushRecipe) updates the SAME library
 * entry — "change the bean of this recipe", not "start a different one".
 *
 * A different bean means a different bag, so the batch is re-resolved exactly
 * the way setRoastDate does it, and the bag we just left is GC'd if nothing
 * references it (an unused one, e.g. picked by mistake, would otherwise linger).
 */
export async function setRecipeBean(bean) {
  const previousBatchId = recipe.beanBatchId;

  recipe.coffeeRoaster = bean?.roaster || '—';
  recipe.coffeeName = bean?.name || '—';
  recipe.beanId = bean?.id ?? null;
  // ensureRecipeBatch early-returns when beanId AND beanBatchId are both set,
  // so these must be cleared for it to resolve the NEW bean's bag.
  recipe.beanBatchId = null;
  recipe.roastDate = null;
  await pushRecipe();

  await gcBatchIfUnused(previousBatchId);
}

/** Swap only the GRINDER of the loaded recipe (the grind SETTING stays — it's
 *  the user's dialed-in number, not a property of the device). No batch work:
 *  the grinder has no bearing on which bag the coffee came from. */
export async function setRecipeGrinder(grinder) {
  recipe.grinderId = grinder?.id ?? null;
  recipe.grinderModel = grinder?.model || '—';
  await pushRecipe();
}
