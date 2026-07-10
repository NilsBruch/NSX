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
function stubCore({ visible = [VISIBLE], withHidden = [VISIBLE, HIDDEN] } = {}) {
  NSXCore.register({
    loadProfiles: async () => visible,
    loadProfilesWithHidden: async () => withHidden,
    isSteamEnabled: () => true,
    getSteamTemp: () => 150,
    getSteamFlow: () => 1.5,
    getSteamDuration: () => 30,
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

test("without a scale: target_volume is zeroed unless volume-stop is enabled", async () => {
  stubCore();
  const off = await NSXCore.buildGatewayPayload({ selectedProfileId: "p-hidden", targetYield: 36 }, { scaleConnected: false });
  assert.equal(off.profile.target_volume, 0);

  const on = await NSXCore.buildGatewayPayload(
    { selectedProfileId: "p-hidden", targetYield: 36, useVolumeStopWhenNoScale: true, volumeCalibration: { factor: 1.1 } },
    { scaleConnected: false },
  );
  assert.equal(on.profile.target_volume, 40, "round(36 * 1.1)");
});

test("bundles the machine-function settings into one atomic payload", async () => {
  stubCore();
  const payload = await NSXCore.buildGatewayPayload({ selectedProfileId: "p-hidden" }, { scaleConnected: true });
  assert.deepEqual(payload.steamSettings, { targetTemperature: 150, flow: 1.5, duration: 30 });
  assert.deepEqual(payload.hotWaterData, { targetTemperature: 90, volume: 200 });
  assert.deepEqual(payload.rinseData, { flow: 6, duration: 5 });
});
