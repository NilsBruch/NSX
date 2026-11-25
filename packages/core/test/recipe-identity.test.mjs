// Recipe identity: bean + grinder + profile, the grinder being a RECORD (id),
// not a model name — one grinder with two burr sets is two records that share
// a model, and must not share recipes or shot histories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/bean.js");
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

test("recipeCandidatesFromShots: one newest shot per unsaved combination, newest first", () => {
  const mk = (ts, profile, grinderId, extra = {}) => ({
    timestamp: ts,
    workflow: { profile: { title: profile }, context: { coffeeRoaster: "Tesy", coffeeName: "ygt", grinderModel: "Mahlkönig EK43", grinderId, ...extra } },
  });
  const shots = [
    mk("2026-11-01T10:00:00Z", "A-Flow", "g-ssp"),
    mk("2026-11-03T10:00:00Z", "A-Flow", "g-ssp"),      // newer of the same combo
    mk("2026-11-02T10:00:00Z", "A-Flow", "g-stock"),    // other burr set: its own combo
    mk("2026-11-04T10:00:00Z", "D-Flow", "g-ssp"),      // already a recipe
    { timestamp: "2026-11-05T10:00:00Z", workflow: { context: { coffeeRoaster: "—" } } }, // unusable
  ];
  const recipes = [{ id: "r1", coffeeRoaster: "Tesy", coffeeName: "ygt", grinderModel: "Mahlkönig EK43", grinderId: "g-ssp", profileTitle: "D-Flow" }];
  const got = NSXCore.recipeCandidatesFromShots(shots, recipes);
  assert.deepEqual(got.map((s) => [s.timestamp.slice(0, 10), s.workflow.context.grinderId]), [
    ["2026-11-03", "g-ssp"], ["2026-11-02", "g-stock"],
  ]);
});

test("recipeEntryFromShot carries what was brewed, and stop-at-weight from the yield", () => {
  const shot = {
    timestamp: "2026-11-03T10:00:00Z",
    workflow: {
      profile: { title: "A-Flow", steps: [{ temperature: 92 }] },
      context: { coffeeRoaster: "Tesy", coffeeName: "ygt", grinderModel: "Niche", grinderId: "g1",
        grinderSetting: "10", targetDoseWeight: 18, targetYield: 36, beanBatchId: "bag-1" },
    },
  };
  const e = NSXCore.recipeEntryFromShot(shot, { id: "r-new", beanId: "b1", profileId: "p1" });
  assert.equal(e.id, "r-new");
  assert.equal(e.grinderId, "g1");
  assert.equal(e.grinderSetting, "10");
  assert.equal(e.targetDoseWeight, 18);
  assert.equal(e.targetYield, 36);
  assert.equal(e.groupTemp, 92);
  assert.equal(e.selectedProfileId, "p1");
  assert.equal(e.beanId, "b1");
  assert.equal(e.beanBatchId, "bag-1");
  assert.equal(e.stopAtWeight, true);
  assert.equal(NSXCore.recipeEntryFromShot({ workflow: { context: { targetYield: 0 } } }, { id: "x" }).stopAtWeight, false);
});

test("a renamed bean keeps its shots: matched by bean id through the bag", () => {
  NSXCore.setBatchBeanMap(new Map([["bag-old", "bean-1"], ["bag-new", "bean-1"]]));
  const recipe = { coffeeRoaster: "Mokuska", coffeeName: "Brazil Gold", grinderModel: "Niche", grinderId: "g1", profileTitle: "Blooming", beanId: "bean-1" };
  const oldShot = { timestamp: "2026-09-01T10:00:00Z", workflow: { profile: { title: "Blooming" },
    context: { coffeeRoaster: "Mokuska", coffeeName: "Brazil", grinderModel: "Niche", grinderId: "g1", beanBatchId: "bag-old" } } };
  const otherBean = { timestamp: "2026-09-02T10:00:00Z", workflow: { profile: { title: "Blooming" },
    context: { coffeeRoaster: "Mokuska", coffeeName: "Brazil Gold", grinderModel: "Niche", grinderId: "g1", beanBatchId: "bag-x" } } };
  NSXCore.setBatchBeanMap(new Map([["bag-old", "bean-1"], ["bag-x", "bean-2"]]));
  const got = NSXCore.findShotsForWorkflow(recipe, [oldShot, otherBean]);
  assert.deepEqual(got.map((s) => s.workflow.context.beanBatchId), ["bag-old"], "old name, same bean: in; same name, other bean: out");
  // ...and it sorts by that shot, not as never brewed.
  const sorted = NSXCore.sortRecipesByLastUsed([{ id: "never", ...recipe, beanId: "bean-9" }, { id: "r", ...recipe }], [oldShot]);
  assert.equal(sorted[0].id, "r");
  NSXCore.setBatchBeanMap(new Map());
});

test("without a resolvable bean on one side, names decide as before", () => {
  NSXCore.setBatchBeanMap(new Map());
  const recipe = { coffeeRoaster: "Mokuska", coffeeName: "Brazil Gold", grinderModel: "Niche", profileTitle: "Blooming", beanId: "bean-1" };
  const shot = { timestamp: "2026-09-01T10:00:00Z", workflow: { profile: { title: "Blooming" },
    context: { coffeeRoaster: "Mokuska", coffeeName: "Brazil Gold", grinderModel: "Niche", beanBatchId: "bag-unknown" } } };
  assert.equal(NSXCore.findShotsForWorkflow(recipe, [shot]).length, 1);
  const renamed = { ...shot, workflow: { ...shot.workflow, context: { ...shot.workflow.context, coffeeName: "Brazil" } } };
  assert.equal(NSXCore.findShotsForWorkflow(recipe, [renamed]).length, 0, "no bag link and a different name: no match");
});

test("recipeSettingsFromShot is only the dial settings, not the identity", () => {
  const shot = { workflow: { profile: { title: "A-Flow", steps: [{ temperature: 94 }] },
    context: { coffeeRoaster: "Tesy", coffeeName: "ygt", grinderModel: "Niche", grinderSetting: "9", targetDoseWeight: 18.5, targetYield: 40 } } };
  assert.deepEqual(NSXCore.recipeSettingsFromShot(shot),
    { grinderSetting: "9", targetDoseWeight: 18.5, targetYield: 40, groupTemp: 94, stopAtWeight: true });
});

