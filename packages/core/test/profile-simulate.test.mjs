// Covers simulateShot: a plausible shot curve derived from a profile's frames,
// as opposed to the frames' goals plotted as rectangles. The assertions here
// are about SHAPE and about the frame semantics the old step plot ignored
// (which variable a frame commands, ramps, limiters, exits) — not about exact
// numbers, which are a model's to choose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/profile-edit.js"); // simulateShot reuses normalizeProfileFrame
loadCoreFile("domains/profile-simulate.js");
const NSXCore = window.NSXCore;

const classicProfile = {
  steps: [
    { name: "Preinfusion", pump: "flow", flow: 4, seconds: 10, temperature: 92 },
    { name: "Extraction", pump: "pressure", pressure: 9, seconds: 25, temperature: 93 },
  ],
};

const max = (a) => a.reduce((m, v) => Math.max(m, v), -Infinity);
const at = (sim, seconds) => sim.t.findIndex((t) => t >= seconds);

test("returns empty, not a crash, for a profile with no frames", () => {
  const sim = NSXCore.simulateShot({ steps: [] });
  assert.equal(sim.t.length, 0);
  assert.equal(sim.duration, 0);
});

test("produces one sample per step across every frame's duration", () => {
  const sim = NSXCore.simulateShot(classicProfile);
  assert.ok(sim.t.length > 300, "35s at 0.1s steps");
  assert.equal(sim.pressure.length, sim.t.length);
  assert.equal(sim.flow.length, sim.t.length);
  assert.equal(sim.weight.length, sim.t.length);
  assert.equal(sim.stages.length, 2);
  assert.equal(sim.stages[0].t0, 0);
  assert.ok(sim.stages[1].t0 > sim.stages[0].t0);
});

test("only the variable a frame commands appears in the goal series", () => {
  const sim = NSXCore.simulateShot(classicProfile);
  // Frame 1 is a flow frame: it has a flow goal and NO pressure goal...
  const i = at(sim, 5);
  assert.equal(sim.targetPressure[i], null);
  assert.ok(sim.targetFlow[i] > 0);
  // ...and frame 2 is the mirror image. This is the whole point: the old step
  // plot drew both lines for both frames.
  const j = at(sim, 20);
  assert.ok(sim.targetPressure[j] > 0);
  assert.equal(sim.targetFlow[j], null);
});

test("the puck resists: flow falls away while pressure builds", () => {
  const sim = NSXCore.simulateShot(classicProfile);
  // Deep into the pressure frame the puck is saturated, so flow has to be far
  // below the 4 ml/s the dry bed let through during preinfusion.
  const early = sim.flow[at(sim, 2)];
  const late = sim.flow[at(sim, 30)];
  assert.ok(early > late, `flow should decay: ${early} -> ${late}`);
  assert.ok(sim.pressure[at(sim, 30)] > 7, "pressure frame reaches its goal");
});

test("nothing reaches the cup until the puck has filled", () => {
  const sim = NSXCore.simulateShot(classicProfile, { dose: 18 });
  assert.equal(sim.weight[0], 0);
  assert.equal(sim.weight[at(sim, 1)], 0, "no output one second in");
  assert.ok(max(sim.weight) > 20, "but a real yield by the end");
  // Weight only ever grows.
  for (let i = 1; i < sim.weight.length; i++) {
    assert.ok(sim.weight[i] >= sim.weight[i - 1]);
  }
});

test("a bigger dose holds more water, so the first drops come later", () => {
  const small = NSXCore.simulateShot(classicProfile, { dose: 12 });
  const big = NSXCore.simulateShot(classicProfile, { dose: 22 });
  const firstDrop = (sim) => sim.t[sim.weight.findIndex((w) => w > 0)];
  assert.ok(firstDrop(big) > firstDrop(small));
});

test("a smooth transition ramps instead of stepping", () => {
  const stepped = NSXCore.simulateShot({
    steps: [{ pump: "pressure", pressure: 9, seconds: 20, transition: "fast" }],
  });
  const ramped = NSXCore.simulateShot({
    steps: [{ pump: "pressure", pressure: 9, seconds: 20, transition: "smooth" }],
  });
  // Two seconds in, a stepped frame is already at pressure; a smooth one is
  // still on its way up.
  assert.ok(stepped.targetPressure[at(stepped, 2)] > ramped.targetPressure[at(ramped, 2)]);
  // Both arrive by the end.
  assert.ok(Math.abs(ramped.targetPressure[ramped.t.length - 1] - 9) < 0.5);
});

test("a flow limiter caps flow and takes the pressure with it", () => {
  const withLimit = NSXCore.simulateShot({
    steps: [{ pump: "pressure", pressure: 9, seconds: 12, limiter: { value: 1.2 } }],
  });
  assert.ok(max(withLimit.flow) <= 1.25, "flow held at the limit");
  // Capping the flow means the pressure the puck sees cannot be the full goal.
  assert.ok(max(withLimit.pressure) < 9, "pressure gives way to the limiter");
});

test("an exit condition ends a frame early", () => {
  const full = NSXCore.simulateShot({
    steps: [
      { pump: "pressure", pressure: 9, seconds: 30 },
      { pump: "pressure", pressure: 6, seconds: 5 },
    ],
  });
  const exits = NSXCore.simulateShot({
    steps: [
      { pump: "pressure", pressure: 9, seconds: 30, exit_if: 1, exit_type: "pressure_over", exit_pressure_over: 4 },
      { pump: "pressure", pressure: 6, seconds: 5 },
    ],
  });
  assert.ok(exits.stages[0].t1 < 3, "quits as soon as it passes 4 bar");
  assert.ok(exits.duration < full.duration);
});

test("an 'under' exit does not fire on the way up from zero", () => {
  // Pressure starts at 0, which is under 4 — without a settling window this
  // frame would quit on its first step and the shot would be one sample long.
  const sim = NSXCore.simulateShot({
    steps: [{ pump: "pressure", pressure: 9, seconds: 15, exit_if: 1, exit_type: "pressure_under", exit_pressure_under: 4 }],
  });
  assert.ok(sim.duration > 5, `ran ${sim.duration}s, so it did not quit at t=0`);
});

test("a frame's weight target stops it, and the profile's stops the shot", () => {
  const sim = NSXCore.simulateShot({
    target_weight: 20,
    steps: [
      { pump: "pressure", pressure: 9, seconds: 60 },
      { pump: "pressure", pressure: 6, seconds: 20 },
    ],
  });
  assert.ok(max(sim.weight) < 21, "stopped at the profile's target weight");
  assert.ok(sim.duration < 60, "well before the frames would have run out");
});

test("never exceeds the machine's own ceilings", () => {
  const sim = NSXCore.simulateShot({
    steps: [{ pump: "flow", flow: 99, seconds: 20 }],
  });
  assert.ok(max(sim.flow) <= 8.01, "pump flow ceiling");
  assert.ok(max(sim.pressure) <= 12.01, "pump pressure ceiling");
});

test("a malformed profile cannot run away", () => {
  const sim = NSXCore.simulateShot({
    steps: Array.from({ length: 50 }, () => ({ pump: "pressure", pressure: 9, seconds: 600 })),
  });
  // One step of slop: the loop writes a sample and then tests the clock, so
  // the cap is "no more than a step past", not "exactly at".
  assert.ok(sim.duration <= 120 + sim.dt + 1e-6, `capped, got ${sim.duration}`);
});

// ── Wiring into the renderer ────────────────────────────────────────────────
// profile-render.test.mjs deliberately does NOT load this domain, so it covers
// the fallback (no simulateShot registered -> the old step plot). These cover
// the other half.
loadCoreFile("domains/profile-render.js");

test("simulated curves are fitted paths; the goals behind them stay straight", () => {
  const svg = NSXCore.renderProfileSpark(classicProfile);
  // Three fitted curves: pressure, flow, temperature.
  assert.equal((svg.match(/<path /g) || []).length, 3);
  assert.match(svg, /d="M [\d.]+ [\d.]+ C /, "cubic segments, not a point list");
  // ...and the goals are polylines, because an instruction is not a
  // measurement and must not be smoothed into one.
  assert.ok((svg.match(/<polyline/g) || []).length >= 2, "one run per commanded frame");
  assert.match(svg, /stroke-dasharray="5,4"/, "goals are dashed");
});

test("the fit drops samples but still ends on the shot's last one", () => {
  const svg = NSXCore.renderProfileSpark(classicProfile);
  const d = svg.match(/<path d="([^"]+)"/)[1];
  const sim = NSXCore.simulateShot(classicProfile);
  // Far fewer curve segments than the ~350 samples behind them.
  const segments = (d.match(/ C /g) || []).length;
  assert.ok(segments < sim.t.length / 2, `${segments} segments for ${sim.t.length} samples`);
  assert.ok(segments > 40, "but enough to keep the shape");
});

test("showGoals: false drops the dashed goals but keeps the simulation", () => {
  const svg = NSXCore.renderProfileSpark(classicProfile, { showGoals: false });
  assert.doesNotMatch(svg, /stroke-dasharray="5,4"/);
  assert.equal((svg.match(/<polyline/g) || []).length, 0);
  assert.equal((svg.match(/<path /g) || []).length, 3);
});

test("simulate: false still renders the original step plot", () => {
  const svg = NSXCore.renderProfileSpark(classicProfile, { simulate: false });
  assert.equal((svg.match(/<polyline/g) || []).length, 3);
  assert.equal((svg.match(/<path /g) || []).length, 0, "rectangles, not curves");
  assert.doesNotMatch(svg, /stroke-dasharray="5,4"/);
});

test("the x axis follows the simulated length, not the sum of the frames", () => {
  // 60s of frames, but an exit at 4 bar ends the first almost immediately.
  const early = {
    steps: [
      { pump: "pressure", pressure: 9, seconds: 40, exit_if: 1, exit_type: "pressure_over", exit_pressure_over: 4 },
      { pump: "pressure", pressure: 6, seconds: 20 },
    ],
  };
  const svg = NSXCore.renderProfileSpark(early, { showXTicks: true });
  assert.doesNotMatch(svg, />60s</, "60s was never reached, so it must not be an axis label");
});
