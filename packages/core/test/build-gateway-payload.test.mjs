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

test("legacy (NSX, no stopAtWeight field): target_volume zeroed unless volume-stop enabled", async () => {
  stubCore();
  const off = await NSXCore.buildGatewayPayload({ selectedProfileId: "p-hidden", targetYield: 36 }, { scaleConnected: false });
  assert.equal(off.profile.target_volume, 0);

  const on = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-hidden", targetYield: 36, useVolumeStopWhenNoScale: true, volumeCalibration: { factor: 1.1 } },
    { scaleConnected: false },
  );
  assert.equal(on.profile.target_volume, 40, "round(36 * 1.1)");
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
  assert.equal(p.profile.target_volume, 0, "no volume stop when weighing");
  assert.equal(p.context.targetYield, 36, "dialed yield drives the weight stop");
});

test("stopAtWeight ON + no scale: volume stop = targetYield * calibration factor", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: true, volumeCalibration: { factor: 1.1 } },
    { scaleConnected: false },
  );
  assert.equal(p.profile.target_volume, 40, "round(36 * 1.1), overriding the profile's own 100");
  assert.equal(p.profile.target_weight, 0, "no weight stop without a scale");
});

test("stopAtWeight ON + no scale: factor defaults to 1.0 when uncalibrated", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: true },
    { scaleConnected: false },
  );
  assert.equal(p.profile.target_volume, 36, "no calibration yet -> 1:1 ml per gram");
});

test("stopAtWeight OFF: manual stop — no weight, no volume, targetYield zeroed", async () => {
  stubCore({ visible: [VOL_PROFILE], withHidden: [VOL_PROFILE] });
  const p = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-vol", targetYield: 36, stopAtWeight: false },
    { scaleConnected: true },
  );
  assert.equal(p.profile.target_weight, 0);
  assert.equal(p.profile.target_volume, 0);
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

// --- Nova's embedded recipe.profile (recipe-owned profile, no library lookup) ---

test("embedded workflow.profile is used directly, without consulting the profile caches", async () => {
  NSXCore.register({
    loadProfiles: async () => { throw new Error("must not be called"); },
    loadProfilesWithHidden: async () => { throw new Error("must not be called"); },
    isSteamEnabled: () => true,
    isSteamTimerEnabled: () => true,
    getSteamTemp: () => 150,
    getSteamFlow: () => 1.5,
    getSteamDuration: () => 30,
    getHotwaterTemp: () => 90,
    getHotwaterVolume: () => 200,
    getFlushFlow: () => 6,
    getFlushDuration: () => 5,
  });

  const embedded = { title: "My Londinium Copy", steps: [{ temperature: 92 }, { temperature: 94 }] };
  const payload = await NSXCore.buildGatewayPayload(
    { profile: embedded, profileTitle: "My Londinium Copy", selectedProfileId: "some-stale-id", coffeeRoaster: "R", coffeeName: "C" },
    { scaleConnected: true },
  );

  assert.notEqual(payload, null);
  assert.equal(payload.profileId, null, "embedded profiles don't carry a library id");
  assert.equal(payload.profile.title, "My Londinium Copy");
  assert.equal(payload.profile.steps.length, 2);
});

test("embedded workflow.profile: temp-delta adjustment still applies", async () => {
  NSXCore.register({
    loadProfiles: async () => { throw new Error("must not be called"); },
    loadProfilesWithHidden: async () => { throw new Error("must not be called"); },
    isSteamEnabled: () => true,
    isSteamTimerEnabled: () => true,
    getSteamTemp: () => 150,
    getSteamFlow: () => 1.5,
    getSteamDuration: () => 30,
    getHotwaterTemp: () => 90,
    getHotwaterVolume: () => 200,
    getFlushFlow: () => 6,
    getFlushDuration: () => 5,
  });

  const embedded = { title: "Embedded", steps: [{ temperature: 92 }, { temperature: 94 }] };
  const payload = await NSXCore.buildGatewayPayload(
    { profile: embedded, groupTemp: 95 },
    { scaleConnected: true },
  );
  assert.deepEqual(payload.profile.steps.map((s) => s.temperature), [95, 97]);
  assert.equal(payload.profile.groupTemp, 95);
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
