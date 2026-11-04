// Covers buildGatewayPayload — the real push-time payload builder.
//
// The headline case is the hidden-profile regression: a recipe may reference a
// profile that was later hidden. Resolution must go through the visible+hidden
// set, otherwise the push is refused (returns null) and the machine keeps the
// old profile. The `loadProfiles` stub below deliberately omits the hidden
// record, so reverting to the visible-only cache makes these tests fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/workflow.js");
// The DYE mapping the payload builder defers to lives in the equipment domain,
// and the volume-stop conversion (volumeForYield) in the mapping domain.
loadCoreFile("domains/equipment.js");
loadCoreFile("domains/mapping.js");
const NSXCore = window.NSXCore;

const VISIBLE = { id: "p-visible", profile: { title: "Visible", steps: [{ temperature: 90 }] } };
const HIDDEN = { id: "p-hidden", profile: { title: "Hidden One", steps: [{ temperature: 92 }, { temperature: 94 }] } };

/** Register the machine-function selectors the payload embeds, plus loaders. */
function stubCore({ visible = [VISIBLE], withHidden = [VISIBLE, HIDDEN], steamTimerEnabled = true } = {}) {
  NSXCore.register({
    loadProfiles: async () => visible,
    loadProfilesWithHidden: async () => withHidden,
    isSteamEnabled: () => true,
    isSteamTimerEnabled: () => steamTimerEnabled,
    getSteamTemp: () => 150,
    getSteamFlow: () => 1.5,
    getSteamDuration: () => 30,
    // Mirrors the real steam domain: dialed value when the timer is on, the
    // 90s safety cap when off (never 0/indefinite).
    getEffectiveSteamDuration: () => (steamTimerEnabled ? 30 : 90),
    getHotwaterTemp: () => 90,
    getHotwaterVolume: () => 200,
    getFlushFlow: () => 6,
    getFlushDuration: () => 5,
  });
}

test("resolves a HIDDEN profile by id and builds a payload (regression: push must not be refused)", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-hidden", profileTitle: "Hidden One", coffeeRoaster: "R", coffeeName: "C" },
    { scaleConnected: true },
  );

  assert.notEqual(payload, null, "a hidden profile must still resolve");
  assert.equal(payload.profileId, "p-hidden");
  assert.equal(payload.profile.title, "Hidden One");
  assert.equal(payload.profile.steps.length, 2);
  assert.equal(payload.name, "R · C · Hidden One");
});

test("resolves a hidden profile by title when no id is stored", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload({ profileTitle: "Hidden One" }, { scaleConnected: true });
  assert.notEqual(payload, null);
  assert.equal(payload.profileId, "p-hidden");
});

test("returns null when the referenced profile cannot be resolved at all", async () => {
  stubCore({ visible: [], withHidden: [] });
  const payload = await NSXCore.buildGatewayPayload({ profileTitle: "Nope" }, { scaleConnected: true });
  assert.equal(payload, null, "refuse to push a frameless profile");
});

test("shifts every frame temperature by the recipe's groupTemp delta", async () => {
  stubCore();
  // Baseline = first frame temp = 92. Desired 95 → delta +3.
  const payload = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-hidden", groupTemp: 95 },
    { scaleConnected: true },
  );
  assert.deepEqual(payload.profile.steps.map((s) => s.temperature), [95, 97]);
  assert.equal(payload.profile.groupTemp, 95);
});

test("prefers the user-owned copy with the highest version when titles collide", async () => {
  const stock = { id: "stock", isDefault: true, profile: { title: "Dup", steps: [{ temperature: 90 }] } };
  const userV1 = { id: "u1", profile: { title: "Dup", version: 1, steps: [{ temperature: 90 }] } };
  const userV3 = { id: "u3", profile: { title: "Dup", version: 3, steps: [{ temperature: 90 }] } };
  stubCore({ visible: [], withHidden: [stock, userV1, userV3] });

  const payload = await NSXCore.buildGatewayPayload({ profileTitle: "Dup" }, { scaleConnected: true });
  assert.equal(payload.profileId, "u3");
});

test("legacy (NSX, no stopAtWeight field): volume stop disabled unless enabled", async () => {
  stubCore();
  const off = await NSXCore.buildGatewayPayload({ selectedProfileId: "p-hidden", targetYield: 36 }, { scaleConnected: false });
  assert.equal(off.context.targetWaterVolume, 0);
  assert.equal(off.profile.target_volume, undefined, "the profile is never overridden");

  const on = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-hidden", targetYield: 36, useVolumeStopWhenNoScale: true, volumeCalibration: { factor: 1.1 } },
    { scaleConnected: false },
  );
  assert.equal(on.context.targetWaterVolume, 40, "round(36 * 1.1)");
});

test("legacy (NSX) + scale: volume stop left to the profile (null)", async () => {
  stubCore();
  const p = await NSXCore.buildGatewayPayload({ selectedProfileId: "p-hidden", targetYield: 36 }, { scaleConnected: true });
  assert.equal(p.context.targetWaterVolume, null, "null inherits the profile's own target_volume");
});

// --- Nova's explicit stopAtWeight three-way stop mode ---

// A profile that defines its own stop-at-volume modifier (100ml), so the
// no-scale fallback has something to preserve.
const VOL_PROFILE = { id: "p-vol", profile: { title: "VolStop", steps: [{ temperature: 90 }], target_weight: 36, target_volume: 100 } };

test("stopAtWeight ON + scale: weight stop, profile volume-stop turned off", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: true },
    { scaleConnected: true },
  );
  assert.equal(p.context.targetWaterVolume, 0, "no volume stop when weighing");
  assert.equal(p.profile.target_volume, 100, "the profile itself is left untouched");
  assert.equal(p.context.targetYield, 36, "dialed yield drives the weight stop");
});

test("stopAtWeight ON + no scale: volume stop = targetYield * calibration factor", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: true, volumeCalibration: { factor: 1.1 } },
    { scaleConnected: false },
  );
  assert.equal(p.context.targetWaterVolume, 40, "round(36 * 1.1), overriding the profile's own 100");
  assert.equal(p.profile.target_volume, 100, "as a workflow field — the profile is not rewritten");
  assert.equal(p.profile.target_weight, 0, "no weight stop without a scale");
});

test("stopAtWeight ON + no scale: factor defaults to 1.0 when uncalibrated", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: true },
    { scaleConnected: false },
  );
  assert.equal(p.context.targetWaterVolume, 36, "no calibration yet -> 1:1 ml per gram");
});

test("stopAtWeight ON + no scale: the learned offset is added before the target weight", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: true, volumeCalibration: { factor: 1.0, offset: 9 } },
    { scaleConnected: false },
  );
  assert.equal(p.context.targetWaterVolume, 45, "9 ml counted before the cup + 36 g * 1.0");
});

test("stopAtWeight OFF: manual stop — no weight, no volume, targetYield zeroed", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: false },
    { scaleConnected: true },
  );
  assert.equal(p.profile.target_weight, 0);
  assert.equal(p.context.targetWaterVolume, 0, "volume stop disabled for the workflow");
  assert.equal(p.context.targetYield, 0, "context yield zeroed so the gateway can't weight-stop");
});

test("bundles the machine-function settings into one atomic payload", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload({ selectedProfileId: "p-hidden" }, { scaleConnected: true });
  assert.deepEqual(payload.steamSettings, { targetTemperature: 150, flow: 1.5, duration: 30 });
  assert.deepEqual(payload.hotWaterData, { targetTemperature: 90, volume: 200 });
  assert.deepEqual(payload.rinseData, { flow: 6, duration: 5 });
});

test("steam timer off: duration pushed as the 90s safety cap, temp/flow untouched", async () => {
  stubCore({ steamTimerEnabled: false });
  const payload = await NSXCore.buildGatewayPayload({ selectedProfileId: "p-hidden" }, { scaleConnected: true });
  assert.deepEqual(payload.steamSettings, { targetTemperature: 150, flow: 1.5, duration: 90 });
});

// --- Recipes only ever carry a library REFERENCE, never their own profile
// copy (reverted: a recipe used to be able to own a diverged profile copy,
// pushed embedded with no library lookup — see the git history around
// buildGatewayPayload). A stray `workflow.profile` field (e.g. leftover data
// from a recipe saved before the revert) must be ignored entirely; only
// selectedProfileId/profileTitle, resolved fresh against the live library on
// every push, decide what gets pushed. ---

test("a stray workflow.profile field is ignored — resolution always goes through the library", async () => {
  stubCore();
  const stray = { title: "Stale Embedded Copy", steps: [{ temperature: 92 }, { temperature: 94 }] };
  const payload = await NSXCore.buildGatewayPayload(
    { profile: stray, profileTitle: "Hidden One", selectedProfileId: "p-hidden", coffeeRoaster: "R", coffeeName: "C" },
    { scaleConnected: true },
  );

  assert.notEqual(payload, null);
  assert.equal(payload.profileId, "p-hidden", "resolved against the library, not the stray embedded copy");
  assert.equal(payload.profile.title, "Hidden One");
});

test("reference-only workflow (no embedded profile) still resolves via the library — unchanged", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-hidden", profileTitle: "Hidden One" },
    { scaleConnected: true },
  );
  assert.notEqual(payload, null);
  assert.equal(payload.profileId, "p-hidden");
  assert.equal(payload.profile.title, "Hidden One");
});


/* ── The DYE fields a recipe stamps onto its shots ───────────────────────── */

const DYE_WORKFLOW = { selectedProfileId: "p-visible", profileTitle: "Visible", targetYield: 36 };

test("a recipe's DYE fields ride into the context, split by where readers look", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload({
    ...DYE_WORKFLOW,
    dye: {
      baristaName: "Nils", drinkerName: "Ada", finalBeverageType: "espresso",
      basketId: "bskt-1", basketName: "VST 18g",
      equipmentIds: ["eqp-1", "eqp-2"], equipmentNames: ["Lunar", "WDT tool"],
    },
  }, {});

  // Native gateway fields stay top-level, where the shot DYE page reads them.
  assert.equal(payload.context.baristaName, "Nils");
  assert.equal(payload.context.drinkerName, "Ada");
  assert.equal(payload.context.finalBeverageType, "espresso");
  // Basket/equipment have no native home — they go under the names DYE2
  // denormalises onto a shot, so it can read a shot we pulled. Equipment is a
  // LIST: one shot, a scale and a WDT tool.
  assert.deepEqual(payload.context.extras, {
    basketId: "bskt-1", basketName: "VST 18g",
    equipmentIds: ["eqp-1", "eqp-2"], equipmentNames: ["Lunar", "WDT tool"],
  });
});

test("DYE fields and tags share `extras` rather than one replacing the other", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload({
    ...DYE_WORKFLOW, tags: ["morning"], dye: { basketId: "bskt-1", basketName: "VST 18g" },
  }, {});

  assert.deepEqual(payload.context.extras, {
    tags: ["morning"], basketId: "bskt-1", basketName: "VST 18g",
  });
});

test("a cleared DYE field is sent as an explicit null, so the gateway drops it", async () => {
  // Omitting a context field leaves the gateway's PREVIOUS value in place —
  // the same reason targetWaterVolume is always sent.
  stubCore();
  const payload = await NSXCore.buildGatewayPayload({ ...DYE_WORKFLOW, dye: { baristaName: "" } }, {});

  assert.equal(payload.context.baristaName, null);
  assert.equal("baristaName" in payload.context, true, "present, not omitted");
  assert.equal(payload.context.extras, null, "nothing in extras, so no empty object");
});

test("a recipe with no DYE fields at all pushes exactly what it used to", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload({ ...DYE_WORKFLOW, tags: ["morning"] }, {});
  assert.deepEqual(payload.context.extras, { tags: ["morning"] });

  const bare = await NSXCore.buildGatewayPayload({ ...DYE_WORKFLOW }, {});
  assert.equal(bare.context.extras, null);
});
