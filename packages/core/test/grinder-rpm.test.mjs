// Covers the variable-RPM question: which grinders offer an RPM field at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/grinder.js");
const NSXCore = window.NSXCore;

test("a grinder has variable RPM exactly when it has a step configured", () => {
  // No flag exists in the gateway schema, so a step IS the flag.
  assert.equal(NSXCore.grinderHasVariableRpm({ rpmSmallStep: 10 }), true);
  assert.equal(NSXCore.grinderHasVariableRpm({ rpmBigStep: 50 }), true);
  assert.equal(NSXCore.grinderHasVariableRpm({ rpmSmallStep: 10, rpmBigStep: 50 }), true);
});

test("the ordinary fixed-speed grinder offers no RPM field", () => {
  assert.equal(NSXCore.grinderHasVariableRpm({ model: "Niche Zero" }), false);
  assert.equal(NSXCore.grinderHasVariableRpm({ rpmSmallStep: null, rpmBigStep: null }), false);
  // Cleared in the editor, which blanks the inputs rather than deleting them.
  assert.equal(NSXCore.grinderHasVariableRpm({ rpmSmallStep: "", rpmBigStep: "" }), false);
  assert.equal(NSXCore.grinderHasVariableRpm(null), false);
});

test("asking by id answers from the loaded list, and false for an unknown one", async () => {
  window.NSXApi = { fetchGrinders: async () => [
    { id: "g-df64", model: "DF64", rpmSmallStep: 10 },
    { id: "g-niche", model: "Niche Zero" },
  ] };
  await NSXCore.loadGrinders();

  assert.equal(NSXCore.grinderIdHasVariableRpm("g-df64"), true);
  assert.equal(NSXCore.grinderIdHasVariableRpm("g-niche"), false);
  assert.equal(NSXCore.grinderIdHasVariableRpm("g-gone"), false, "a deleted grinder must not throw");
});
