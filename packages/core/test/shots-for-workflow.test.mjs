// Covers fetchShotsForWorkflow: a recipe's whole shot history, asked of the
// gateway instead of filtered out of a skin's recent-shots window. The bug it
// exists for: a recipe not brewed in a while falls outside that window, so the
// skin reported "no shots" for a recipe with plenty of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/shot.js");
loadCoreFile("domains/mapping.js"); // findShotsForWorkflow narrows the result
const NSXCore = window.NSXCore;

const recipe = {
  coffeeRoaster: "Five Elephant",
  coffeeName: "Kenya AA",
  grinderModel: "Niche",
  profileTitle: "Blooming espresso",
};

const shot = (id, ts, ctx = {}) => ({
  id,
  timestamp: ts,
  workflow: {
    profile: { title: "Blooming espresso" },
    context: {
      coffeeRoaster: "Five Elephant",
      coffeeName: "Kenya AA",
      grinderModel: "Niche",
      ...ctx,
    },
  },
});

test("queries the gateway scoped to this bean, grinder and profile", async () => {
  let filters = null;
  window.NSXApi = {
    fetchShots: async (f) => { filters = f; return { items: [shot("old", "2024-01-05T08:00:00Z")], total: 1 }; },
  };

  const list = await NSXCore.fetchShotsForWorkflow(recipe);

  assert.equal(filters.coffeeRoaster, "Five Elephant");
  assert.equal(filters.coffeeName, "Kenya AA");
  assert.equal(filters.grinderModel, "Niche");
  assert.equal(filters.profileTitle, "Blooming espresso");
  assert.equal(filters.offset, 0);
  assert.ok(filters.limit >= 200, "asks for a deep page, not the default 20");
  // A year-old shot comes back — the whole point: no recency window applies.
  assert.deepEqual(list.map((s) => s.id), ["old"]);
});

test("newest first, and anything the server's looser match let through is dropped", async () => {
  window.NSXApi = {
    fetchShots: async () => ({
      items: [
        shot("mid", "2024-06-01T08:00:00Z"),
        // Same bean, a different grinder: not this recipe.
        shot("other", "2025-06-01T08:00:00Z", { grinderModel: "EG-1" }),
        shot("new", "2025-01-01T08:00:00Z"),
      ],
      total: 3,
    }),
  };

  const list = await NSXCore.fetchShotsForWorkflow(recipe);
  assert.deepEqual(list.map((s) => s.id), ["new", "mid"]);
});

test("an unset field ('—') is never sent as a filter", async () => {
  let filters = null;
  window.NSXApi = { fetchShots: async (f) => { filters = f; return { items: [] }; } };

  await NSXCore.fetchShotsForWorkflow({ ...recipe, grinderModel: "—", profileTitle: "" });

  assert.equal(filters.grinderModel, undefined, "'—' means unset, not a grinder named that");
  assert.equal(filters.profileTitle, undefined);
  assert.equal(filters.coffeeName, "Kenya AA");
});

test("a bare array response (no {items}) is handled", async () => {
  window.NSXApi = { fetchShots: async () => [shot("a", "2024-02-02T08:00:00Z")] };
  const list = await NSXCore.fetchShotsForWorkflow(recipe);
  assert.deepEqual(list.map((s) => s.id), ["a"]);
});
