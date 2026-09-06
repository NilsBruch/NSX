// Covers mapping.js's getBatchAge: a recipe's roast-date age, formatted as
// "N day(s)/week(s)/month(s)/year(s)". Ported from NSX's formatBatchAge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/mapping.js");
const NSXCore = window.NSXCore;

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

test("without NSXI18n loaded, falls back to the bare unit name (no crash)", () => {
  // translations.js is deliberately NOT loaded in this file — getBatchAge must
  // still work, the same optional-chaining guard buildShotDiffData already uses.
  assert.equal(NSXCore.getBatchAge(daysAgo(3)), "3 days");
  assert.equal(NSXCore.getBatchAge(daysAgo(1)), "1 day");
});

test("boundaries: days -> weeks -> months -> years", () => {
  assert.equal(NSXCore.getBatchAge(daysAgo(6)), "6 days");
  assert.equal(NSXCore.getBatchAge(daysAgo(7)), "1 week");
  assert.equal(NSXCore.getBatchAge(daysAgo(29)), "4 weeks");
  assert.equal(NSXCore.getBatchAge(daysAgo(30)), "1 month");
  assert.equal(NSXCore.getBatchAge(daysAgo(364)), "12 months");
  assert.equal(NSXCore.getBatchAge(daysAgo(365)), "1 year");
});

test("uses NSXI18n.t for the unit when translations.js is loaded", () => {
  loadCoreFile("translations.js");
  window.NSXI18n.setLang("en");
  assert.equal(NSXCore.getBatchAge(daysAgo(14)), "2 weeks");
  assert.equal(NSXCore.getBatchAge(daysAgo(1)), "1 day");
});

test("returns the em dash for missing, invalid, or future dates", () => {
  assert.equal(NSXCore.getBatchAge(null), "—");
  assert.equal(NSXCore.getBatchAge(""), "—");
  assert.equal(NSXCore.getBatchAge("not-a-date"), "—");
  assert.equal(NSXCore.getBatchAge(new Date(Date.now() + 86_400_000).toISOString()), "—");
});
