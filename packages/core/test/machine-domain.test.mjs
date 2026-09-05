// Covers the machine domain's operation guard (canExecuteOperation) — the
// pure per-state allow-list any skin's UI relies on to enable/disable actions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/machine.js");
const NSXCore = window.NSXCore;

test("skipStep is allowed during espresso", () => {
  assert.equal(NSXCore.canExecuteOperation("skipStep", "espresso"), true);
});

test("skipStep is not allowed outside espresso", () => {
  assert.equal(NSXCore.canExecuteOperation("skipStep", "idle"), false);
  assert.equal(NSXCore.canExecuteOperation("skipStep", "steam"), false);
});

test("stopShot remains the only other espresso operation", () => {
  assert.equal(NSXCore.canExecuteOperation("stopShot", "espresso"), true);
  assert.equal(NSXCore.canExecuteOperation("setState", "espresso"), false);
});

test("setMachineState/getMachineState round-trip and canExecuteOperation defaults to the current state", () => {
  NSXCore.setMachineState("espresso");
  assert.equal(NSXCore.getMachineState(), "espresso");
  assert.equal(NSXCore.canExecuteOperation("skipStep"), true);
  NSXCore.setMachineState("idle");
  assert.equal(NSXCore.canExecuteOperation("skipStep"), false);
});
