// recentFromShots: what a picker puts above the library ("last three beans",
// "last three profiles").
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/mapping.js");
const { recentFromShots } = window.NSXCore;

const shot = (timestamp, bean) => ({ timestamp, workflow: { context: { coffeeName: bean } } });
const beanOf = (s) => s.workflow.context.coffeeName;

test("newest first, no repeats, capped at the limit", () => {
  const shots = [
    shot("2026-09-01T10:00:00", "A"),
    shot("2026-09-04T10:00:00", "C"),
    shot("2026-09-03T10:00:00", "B"),
    shot("2026-09-05T10:00:00", "B"), // newest overall: B leads, and only once
    shot("2026-09-02T10:00:00", "D"),
  ];
  // B(09-05), C(09-04), B again(09-03, dropped), D(09-02) — A(09-01) is a shot
  // too old to make the top three.
  assert.deepEqual(recentFromShots(shots, beanOf), ["B", "C", "D"]);
  assert.deepEqual(recentFromShots(shots, beanOf, { limit: 2 }), ["B", "C"]);
});

test("a shot whose thing can't be resolved is skipped, not left as a hole", () => {
  // The middle shot's bean was deleted from the library: resolve returns null.
  const shots = [shot("2026-09-03T10:00:00", "A"), shot("2026-09-02T10:00:00", "gone"), shot("2026-09-01T10:00:00", "B")];
  const resolve = (s) => (beanOf(s) === "gone" ? null : beanOf(s));
  assert.deepEqual(recentFromShots(shots, resolve), ["A", "B"]);
});

test("identity is the record's id, so the same bean re-read counts once", () => {
  const shots = [
    { timestamp: "2026-09-02T10:00:00" },
    { timestamp: "2026-09-01T10:00:00" },
  ];
  const sameBean = () => ({ id: "bean-1", name: "Red Brick" });
  assert.deepEqual(recentFromShots(shots, sameBean), [{ id: "bean-1", name: "Red Brick" }]);
});

test("empty, missing and malformed input answer with an empty list", () => {
  assert.deepEqual(recentFromShots([], beanOf), []);
  assert.deepEqual(recentFromShots(null, beanOf), []);
  assert.deepEqual(recentFromShots([shot("2026-09-01T10:00:00", "A")], null), []);
});
