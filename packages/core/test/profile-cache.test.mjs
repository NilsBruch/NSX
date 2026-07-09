// Covers the profile domain's raw-payload memo (added for ETag-based
// cross-device refresh): an unchanged fetch (304 → same reference) must keep
// the normalized cache reference stable so the skin can skip re-rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/profile.js");
const NSXCore = window.NSXCore;

test("loadProfiles keeps the cache reference stable on an unchanged payload (304)", async () => {
  const raw = [{ id: "p1", profile: { title: "A", steps: [{}] } }];
  // Returning the SAME array reference each call mimics getWithEtag's 304 path.
  window.NSXApi = { fetchProfiles: async () => raw };

  const first = await NSXCore.loadProfiles(true);
  const second = await NSXCore.loadProfiles(true);

  assert.equal(second, first, "same normalized array returned when payload is unchanged");
  assert.equal(NSXCore.getProfiles(), first, "getProfiles() stays the same reference");
});

test("loadProfiles rebuilds the cache when the payload changes (200)", async () => {
  const raw1 = [{ id: "p1", profile: { title: "A", steps: [{}] } }];
  const raw2 = [
    { id: "p1", profile: { title: "A", steps: [{}] } },
    { id: "p2", profile: { title: "B", steps: [{}] } },
  ];
  let current = raw1;
  window.NSXApi = { fetchProfiles: async () => current };

  const a = await NSXCore.loadProfiles(true);
  current = raw2; // new reference → a real change
  const b = await NSXCore.loadProfiles(true);

  assert.notEqual(b, a, "a new array is built when the payload changed");
  assert.equal(b.length, 2);
});
