// analyzeShot: the shot-analysis numbers NSX's shot review has always shown,
// moved from NSX's ui.js into core. The first test is the contract: on the
// mock gateway's real recorded shots, the core version must give exactly the
// numbers the old skin code gave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";
import { shotsFull } from "../../../tests/mock-gateway/fixtures.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/mapping.js");
const { analyzeShot, normalizeShotData } = window.NSXCore;

/** NSX ui.js renderShotAnalysis before the move, verbatim, with the labels
 *  and string formatting stripped so it returns the bare numbers. */
function legacyAnalysis(normalized) {
  const elapsed = normalized?.elapsed || [];
  const pressure = normalized?.pressure || [];
  const flow = normalized?.flow || [];
  const substates = normalized?.substates || [];
  if (!elapsed.length) return null;
  const preinfusionIdx = new Set();
  for (let i = 0; i < substates.length; i++) if (substates[i] === "preinfusion") preinfusionIdx.add(i);
  const hasPhases = preinfusionIdx.size > 0;
  function integFlow(fromIdx, toIdx) {
    let vol = 0;
    for (let i = Math.max(1, fromIdx); i <= toIdx && i < elapsed.length; i++) {
      const dt = elapsed[i] - elapsed[i - 1];
      const f = ((flow[i] || 0) + (flow[i - 1] || 0)) / 2;
      vol += Math.max(0, f) * dt;
    }
    return vol;
  }
  function avgInSet(arr, idxSet, minVal = 0) {
    let sum = 0, n = 0;
    idxSet.forEach((i) => { const v = arr[i]; if (Number.isFinite(v) && v > minVal) { sum += v; n++; } });
    return n > 0 ? sum / n : null;
  }
  const lastIdx = elapsed.length - 1;
  const extractionIdx = new Set();
  for (let i = 0; i <= lastIdx; i++) if (!preinfusionIdx.has(i)) extractionIdx.add(i);
  let preEndIdx = -1;
  for (let i = lastIdx; i >= 0; i--) if (preinfusionIdx.has(i)) { preEndIdx = i; break; }
  const exStartIdx = preEndIdx + 1;
  if (hasPhases) {
    return {
      pre: integFlow(0, preEndIdx), ex: integFlow(exStartIdx, lastIdx),
      avgP: avgInSet(pressure, extractionIdx, 0.5), avgF: avgInSet(flow, extractionIdx, 0.1),
    };
  }
  const allIdx = new Set(Array.from({ length: elapsed.length }, (_, i) => i));
  return { total: integFlow(0, lastIdx), avgP: avgInSet(pressure, allIdx, 0.5), avgF: avgInSet(flow, allIdx, 0.1) };
}

test("same numbers as NSX's old analysis, on every recorded fixture shot", () => {
  assert.ok(shotsFull.length > 0);
  for (const shot of shotsFull) {
    const n = normalizeShotData(shot);
    const old = legacyAnalysis(n);
    const now = analyzeShot(n);
    if (now.hasPhases) {
      assert.equal(now.preinfusionMl, old.pre, `${shot.id} preinfusion`);
      assert.equal(now.extractionMl, old.ex, `${shot.id} extraction`);
    } else {
      assert.equal(now.totalMl, old.total, `${shot.id} total`);
    }
    assert.equal(now.avgPressure, old.avgP, `${shot.id} avg pressure`);
    assert.equal(now.avgFlow, old.avgF, `${shot.id} avg flow`);
  }
});

// 11 samples one second apart at a steady 2 ml/s and 9 bar; the first five
// (0-4 s) marked preinfusion.
const steady = (withPhases) => ({
  elapsed: Array.from({ length: 11 }, (_, i) => i),
  flow: Array(11).fill(2),
  pressure: Array(11).fill(9),
  substates: Array.from({ length: 11 }, (_, i) => (withPhases && i < 5 ? "preinfusion" : "pouring")),
});

test("splits the water at the end of preinfusion, and the parts add up", () => {
  const a = analyzeShot(steady(true));
  assert.equal(a.hasPhases, true);
  assert.equal(a.preinfusionMl, 8);   // 0 -> 4 s at 2 ml/s
  assert.equal(a.extractionMl, 12);   // 4 -> 10 s, including the step across the boundary
  assert.equal(a.totalMl, 20);
  assert.equal(a.avgPressure, 9);
  assert.equal(a.avgFlow, 2);
});

test("no preinfusion phase: one total, averages over the whole shot", () => {
  const a = analyzeShot(steady(false));
  assert.equal(a.hasPhases, false);
  assert.equal(a.preinfusionMl, null);
  assert.equal(a.extractionMl, null);
  assert.equal(a.totalMl, 20);
});

test("a pause does not drag the averages down", () => {
  const s = steady(false);
  s.pressure[5] = 0.2; // below the 0.5 bar floor
  s.flow[5] = 0.05;    // below the 0.1 ml/s floor
  const a = analyzeShot(s);
  assert.equal(a.avgPressure, 9);
  assert.equal(a.avgFlow, 2);
});

test("no samples, no analysis", () => {
  assert.equal(analyzeShot(null), null);
  assert.equal(analyzeShot({ elapsed: [] }), null);
});
