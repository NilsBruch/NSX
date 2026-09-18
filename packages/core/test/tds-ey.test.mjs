// eyFromTds / tdsFromEy: EY % = TDS % × beverage weight ÷ dry dose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/mapping.js");
const { eyFromTds, tdsFromEy } = window.NSXCore;

test("a textbook espresso: 18 g in, 36 g out, TDS 9.5 % is EY 19 %", () => {
  assert.equal(eyFromTds(9.5, 18, 36), 19);
  assert.equal(tdsFromEy(19, 18, 36), 9.5);
});

test("the two are inverses, to the rounding", () => {
  const ey = eyFromTds(8.73, 18.2, 40.6);
  assert.ok(Math.abs(tdsFromEy(ey, 18.2, 40.6) - 8.73) <= 0.01);
});

test("rounded to two decimals", () => {
  assert.equal(eyFromTds(9.123, 18, 37), 18.75);
});

test("no number from input that can't give one", () => {
  for (const [dose, out] of [[0, 36], [18, 0], [null, 36], [18, undefined], [-18, 36], ["x", 36]]) {
    assert.equal(eyFromTds(9.5, dose, out), null, `dose ${dose}, out ${out}`);
    assert.equal(tdsFromEy(19, dose, out), null, `dose ${dose}, out ${out}`);
  }
  assert.equal(eyFromTds(-1, 18, 36), null, "a negative reading");
  assert.equal(tdsFromEy(null, 18, 36), null, "no reading");
});

test("zero is a reading, not a missing one", () => {
  assert.equal(eyFromTds(0, 18, 36), 0);
});
