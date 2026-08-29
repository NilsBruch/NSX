// Covers updateShotWorkflowContext: patching the recipe-as-brewed (grind
// setting, roaster/bean, targets) on a stored shot. The gateway REPLACES
// `workflow` on a PUT, so the whole point of this helper is that it merges
// onto the full record instead of sending the context alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/shot.js");
const NSXCore = window.NSXCore;

const fullShot = () => ({
  id: "s1",
  workflow: {
    // The field a context-only patch would drop — the reason for the merge.
    profile: { title: "Blooming espresso", steps: [{ name: "fill" }] },
    context: { grinderSetting: "16", coffeeName: "Kenya AA", targetDoseWeight: 18 },
  },
  annotations: { enjoyment: 80 },
});

test("sends the full workflow with only the patched context fields changed", async () => {
  let sent = null;
  window.NSXApi = {
    fetchShotDetails: async () => fullShot(),
    updateShotRecord: async (id, patch) => { sent = { id, patch }; return { ok: true }; },
  };

  await NSXCore.updateShotWorkflowContext("s1", { grinderSetting: "14.5" });

  assert.equal(sent.id, "s1");
  assert.deepEqual(sent.patch.workflow.profile, fullShot().workflow.profile, "profile survives");
  assert.equal(sent.patch.workflow.context.grinderSetting, "14.5", "patched field");
  assert.equal(sent.patch.workflow.context.coffeeName, "Kenya AA", "untouched field survives");
  assert.equal(sent.patch.workflow.context.targetDoseWeight, 18);
  assert.equal(sent.patch.annotations, undefined, "annotations are not touched");
});

test("invalidates the detail cache, so the next read reflects the edit", async () => {
  let fetches = 0;
  window.NSXApi = {
    fetchShotDetails: async () => { fetches++; return fullShot(); },
    updateShotRecord: async () => ({ ok: true }),
  };

  await NSXCore.getShotDetails("s2");
  assert.equal(fetches, 1);
  await NSXCore.getShotDetails("s2");
  assert.equal(fetches, 1, "cached");

  await NSXCore.updateShotWorkflowContext("s2", { grinderSetting: "12" });
  await NSXCore.getShotDetails("s2");
  // The helper reads the cached record (no fetch), then updateShot invalidates
  // it — so exactly one more fetch, on the read after the edit.
  assert.equal(fetches, 2);
});

test("a shot with no workflow at all still gets a valid context", async () => {
  let sent = null;
  window.NSXApi = {
    fetchShotDetails: async () => ({ id: "s3" }),
    updateShotRecord: async (id, patch) => { sent = patch; return { ok: true }; },
  };

  await NSXCore.updateShotWorkflowContext("s3", { grinderSetting: "20" });

  assert.deepEqual(sent.workflow, { context: { grinderSetting: "20" } });
});
