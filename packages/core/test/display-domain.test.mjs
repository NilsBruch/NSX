// Covers the display domain: the host-capability half of GET /api/v1/display
// (platformSupported), which skins read to hide brightness / wake-lock controls
// that the platform cannot honour. The interesting rule is the DEFAULT: only an
// explicit `false` hides a control, so an old or unreachable gateway leaves the
// UI exactly as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/display.js");
const NSXCore = window.NSXCore;

const withState = (state) => {
  window.NSXApi = { fetchDisplayState: async () => state };
};

test("both capabilities are assumed supported before anything is loaded", () => {
  assert.deepEqual(NSXCore.getDisplaySupport(), { brightness: true, wakeLock: true });
});

test("an explicit false is reported, and emitted as displaySupportLoaded", async () => {
  withState({
    brightness: 97,
    platformSupported: { brightness: false, wakeLock: true },
  });
  let emitted = null;
  NSXCore.on("displaySupportLoaded", (p) => { emitted = p; });

  const result = await NSXCore.loadDisplaySupport(true);

  assert.deepEqual(result, { brightness: false, wakeLock: true });
  assert.deepEqual(NSXCore.getDisplaySupport(), { brightness: false, wakeLock: true });
  assert.deepEqual(emitted, { brightness: false, wakeLock: true });
});

test("the answer is cached — a second call does not re-fetch", async () => {
  let calls = 0;
  window.NSXApi = {
    fetchDisplayState: async () => { calls++; return { platformSupported: { brightness: false, wakeLock: false } }; },
  };
  await NSXCore.loadDisplaySupport(true);
  assert.equal(calls, 1);

  await NSXCore.loadDisplaySupport();
  assert.equal(calls, 1, "cached; capability can't change while the skin is open");

  await NSXCore.loadDisplaySupport(true);
  assert.equal(calls, 2, "force re-fetches");
});

test("a gateway that omits platformSupported is treated as supporting both", async () => {
  withState({ brightness: 80, wakeLockEnabled: true });
  assert.deepEqual(await NSXCore.loadDisplaySupport(true), { brightness: true, wakeLock: true });
});

test("a failed fetch keeps the last known answer instead of hiding controls", async () => {
  withState({ platformSupported: { brightness: true, wakeLock: false } });
  await NSXCore.loadDisplaySupport(true);

  window.NSXApi = { fetchDisplayState: async () => { throw new Error("gateway down"); } };
  const result = await NSXCore.loadDisplaySupport(true);

  assert.deepEqual(result, { brightness: true, wakeLock: false });
});
