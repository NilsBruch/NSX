// Covers renderProfileSpark: a pure SVG string for a profile's curve. Ported
// from NSX's _profileSparkSvg — behavior-preserving except theme is now an
// explicit option instead of a document.documentElement read (core has no DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/profile-render.js");
const NSXCore = window.NSXCore;

const profile = {
  steps: [
    { name: "Preinfusion", temperature: 90, seconds: 10, pressure: 3, flow: 4 },
    { name: "Extraction", temperature: 92, seconds: 20, pressure: 9, flow: 2 },
  ],
};

test("renders an <svg> with one polyline per curve for a profile with frames", () => {
  const svg = NSXCore.renderProfileSpark(profile);
  assert.match(svg, /<svg class="profile-spark"/);
  assert.equal((svg.match(/<polyline/g) || []).length, 3, "pressure + flow + temp");
  assert.match(svg, /viewBox="0 0 680 274"/);
});

test("supports profiles that use `frames` instead of `steps` (legacy shape)", () => {
  const svg = NSXCore.renderProfileSpark({ frames: profile.steps });
  assert.match(svg, /<svg class="profile-spark"/);
});

test("returns a placeholder div, not an SVG, when the profile has no frames", () => {
  assert.match(NSXCore.renderProfileSpark({ steps: [] }), /^<div class="profile-picker-placeholder">/);
  assert.match(NSXCore.renderProfileSpark(null), /^<div class="profile-picker-placeholder">/);
});

test("the empty-state label is overridable (core has no i18n of its own)", () => {
  const svg = NSXCore.renderProfileSpark({ steps: [] }, { emptyLabel: "Kein Profil" });
  assert.match(svg, />Kein Profil</);
});

test("theme is an explicit option, not a DOM read — dark vs light change the fill colors", () => {
  const dark = NSXCore.renderProfileSpark(profile, { theme: "dark" });
  const light = NSXCore.renderProfileSpark(profile, { theme: "light" });
  assert.notEqual(dark, light);
  assert.match(dark, /rgba\(0,0,0,0\.22\)/);
  assert.match(light, /#ffffff/);
});

test("showLegend/showXTicks/showYTicks/showStageLabels toggle their markup", () => {
  const bare = NSXCore.renderProfileSpark(profile, {
    showLegend: false, showXTicks: false, showYTicks: false, showStageLabels: false,
  });
  assert.doesNotMatch(bare, /Pressure \(bar\)/);
  assert.doesNotMatch(bare, />Preinfusion</);
});

test("showTempLine defaults to on (3 polylines) and can be turned off (2 polylines)", () => {
  const withTemp = NSXCore.renderProfileSpark(profile);
  assert.equal((withTemp.match(/<polyline/g) || []).length, 3);

  const withoutTemp = NSXCore.renderProfileSpark(profile, { showTempLine: false });
  assert.equal((withoutTemp.match(/<polyline/g) || []).length, 2, "pressure + flow only");
});

test("pressureMax overrides the auto-scaled ceiling", () => {
  const auto = NSXCore.renderProfileSpark(profile, { showYTicks: true });
  assert.match(auto, />16</, "auto-scaled ceiling for this profile's 9-bar peak");

  const fixed = NSXCore.renderProfileSpark(profile, { showYTicks: true, pressureMax: 12 });
  assert.match(fixed, />12</);
  assert.doesNotMatch(fixed, />16</);
});

test("showTempLine:false also reclaims the reserved temp-band separator, not just the line itself", () => {
  const withTemp = NSXCore.renderProfileSpark(profile, { showTempLine: true });
  const withoutTemp = NSXCore.renderProfileSpark(profile, { showTempLine: false });
  assert.match(withTemp, /stroke-dasharray="4,3"/);
  assert.doesNotMatch(withoutTemp, /stroke-dasharray="4,3"/);
});

test("stays a pure function: same input, same output, no shared mutable state", () => {
  const a = NSXCore.renderProfileSpark(profile);
  const b = NSXCore.renderProfileSpark(profile);
  assert.equal(a, b);
});
