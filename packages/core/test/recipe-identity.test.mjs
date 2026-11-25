// Recipe identity: bean + grinder + profile, the grinder being a RECORD (id),
// not a model name — one grinder with two burr sets is two records that share
// a model, and must not share recipes or shot histories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/mapping.js");
const NSXCore = window.NSXCore;

const base = { coffeeRoaster: "Tesy", coffeeName: "ygt", grinderModel: "Mahlkönig EK43", profileTitle: "A-Flow" };
const shot = (grinderId) => ({
  timestamp: "2026-11-24T10:00:00Z",
  workflow: { profile: { title: "A-Flow" }, context: { coffeeRoaster: "Tesy", coffeeName: "ygt", grinderModel: "Mahlkönig EK43", ...(grinderId ? { grinderId } : {}) } },
});

test("two burr sets on one model are different recipes when both carry grinder ids", () => {
  assert.equal(NSXCore.isSameRecipe({ ...base, grinderId: "g-ssp" }, { ...base, grinderId: "g-stock" }), false);
  assert.equal(NSXCore.isSameRecipe({ ...base, grinderId: "g-ssp" }, { ...base, grinderId: "g-ssp" }), true);
});

test("without an id on either side, the model name decides — as before", () => {
  assert.equal(NSXCore.isSameRecipe(base, { ...base, grinderId: "g-ssp" }), true);
  assert.equal(NSXCore.isSameRecipe(base, { ...base, grinderModel: "Niche" }), false);
});

test("a recipe's shots are the ones from ITS grinder record, plus id-less older ones", () => {
  const shots = [shot("g-ssp"), shot("g-stock"), shot(null)];
  const got = NSXCore.findShotsForWorkflow({ ...base, grinderId: "g-ssp" }, shots);
  assert.equal(got.length, 2);
  assert.equal(got.some((s) => s.workflow.context.grinderId === "g-stock"), false);
  // NSX-style workflow without a grinderId: unchanged, every model match counts.
  assert.equal(NSXCore.findShotsForWorkflow(base, shots).length, 3);
});

test("findMatchingRecipe finds the existing recipe, and can skip the one being edited", () => {
  const recipes = [{ id: "r1", ...base, grinderId: "g-ssp" }, { id: "r2", ...base, grinderId: "g-stock" }];
  assert.equal(NSXCore.findMatchingRecipe(recipes, { ...base, grinderId: "g-stock" })?.id, "r2");
  assert.equal(NSXCore.findMatchingRecipe(recipes, { ...base, grinderId: "g-stock" }, "r2"), null);
  assert.equal(NSXCore.findMatchingRecipe(recipes, { ...base, profileTitle: "D-Flow" }), null);
});

test("the identity key changes with the grinder record, not only the model", () => {
  assert.notEqual(NSXCore.getRecipeIdentityKey({ ...base, grinderId: "g-ssp" }), NSXCore.getRecipeIdentityKey({ ...base, grinderId: "g-stock" }));
});
