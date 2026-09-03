"use strict";
/**
 * NSXCore profile-simulate domain — what a shot run on this profile would
 * plausibly LOOK like, as opposed to what the profile commands. Pure: every
 * call is a function of its arguments, no state, no DOM (same category as
 * mapping.js and profile-render.js).
 *
 * Why this exists at all. A profile preview used to plot the frames' goals as
 * a step function, which misrepresents a shot in three separate ways:
 *
 *   1. It drew BOTH a pressure and a flow line for every frame. A DE1 frame
 *      commands exactly one of the two (`pump: "pressure" | "flow"`); the
 *      other is not a goal but the puck's ANSWER to it. Half of those lines
 *      were numbers the machine never aimed at.
 *   2. It ignored `transition: "smooth"`, the per-frame limiter, and every
 *      exit condition — so a frame that in reality ramps, gets capped, or
 *      quits after two seconds was drawn as a full-length rectangle.
 *   3. Nothing bends. A real shot's flow collapses as the puck saturates and
 *      the pressure sags under it; a rectangle says the puck isn't there.
 *
 * The model. Espresso hydraulics use the DE1 community's own convention,
 * which is also what the machine reports as "resistance":
 *
 *     R = P / Q²        <=>        Q = sqrt(P / R)
 *
 * with P in bar and Q in ml/s. The one thing that makes a shot curve look
 * like a shot curve is that R is not constant — it is a function of how wet
 * the puck is:
 *
 *   - Dry, at the start: barely any back-pressure at all. The water is filling
 *     voids rather than being forced THROUGH a bed, which is how a Fill frame
 *     runs 8 ml/s at well under a bar. Resistance stays near zero and then
 *     climbs very steeply as the last of that space fills — which is why
 *     preinfusion flow starts high and falls away.
 *   - Saturating: the grounds swell and the bed compacts, and R climbs
 *     steeply towards its brewing value (R ~ 2.25, so 9 bar gives ~2 ml/s).
 *   - Nothing reaches the cup until the puck has taken up what it can hold,
 *     which is where the familiar dead time before the first drops comes
 *     from — not from a delay, but from a puck that is still filling.
 *   - Late on, the bed erodes slightly and R drifts back down, which is the
 *     gentle flow rise at the end of a long shot.
 *
 * Everything else is bookkeeping the frames already describe: the pump can't
 * jump (it eases towards a setpoint), "smooth" ramps the target across the frame instead of
 * stepping to it, a limiter caps the OTHER variable, and a frame ends at the
 * first of its duration, its exit condition, its weight or its volume.
 *
 * This is a plausible shot, not a prediction of YOUR shot: it knows nothing
 * about the grind, the bean or the basket. Its job is to make a preview look
 * like espresso rather than like a bar chart, and callers should present it
 * as such (profile-render draws the commanded goals dashed behind it, so the
 * two are never confused).
 *
 * Registered on NSXCore:
 *   simulateShot(profile, opts?) -> { t, pressure, flow, weight, temperature,
 *                                     targetPressure, targetFlow, stages,
 *                                     duration, dt }
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.profile-simulate] core.js must load before domains/profile-simulate.js");
    return;
  }

  // ── The puck ──────────────────────────────────────────────────────────────
  // Tuned against three points a barista would recognise: a Fill frame pushing
  // 8 ml/s into a dry basket sees well under a bar; 3 bar into a half-filled
  // puck gives ~4.5 ml/s; and 9 bar through a saturated one gives ~2 ml/s.
  const R_DRY = 0.004;       // P/Q² of a dry bed — essentially no back-pressure
  const R_WET = 2.25;        // P/Q² once saturated and compacted
  // The exponent is the shape of the whole preinfusion. A low one starts
  // building resistance from the first drop of water and puts pressure on the
  // puck almost at once; s⁴ keeps the bed open until it is nearly full and
  // then closes it fast. That is both what actually happens and what makes a
  // Fill frame last the few seconds it should, instead of tripping its
  // pressure exit on one of its first steps.
  const SATURATION_EXP = 4;
  const EROSION_PER_S = 0.004; // R drift once brewing, per second
  const EROSION_MAX = 0.15;   // ...capped, so a long shot doesn't run away

  // ── The machine ───────────────────────────────────────────────────────────
  const PUMP_MAX_FLOW = 8.0;  // ml/s the pump can deliver at all
  const PUMP_MAX_PRESSURE = 12.0;
  // Time constants for the lag below (see `lag`): ~63% of a move in one tau,
  // ~95% in three, so the group still takes about a second to change pressure
  // — the timing the old 9 bar/s rate limiter had, without the corner where
  // it stopped.
  // Applied TWICE in series (see the loop), so the pair behaves as a
  // second-order system: a step at the input comes out with a continuous
  // SLOPE, not just a continuous value. One lag alone leaves a corner at
  // every step in the commanded target -- the value no longer jumps, but the
  // slope does, and that is the kink the eye actually picks up. Two of these
  // at 0.22s settle in about the same second the single 0.32s one did.
  const PRESSURE_TAU = 0.22;  // s
  const FLOW_TAU = 0.22;      // s
  const TEMP_TAU = 1.2;       // s -- the group's thermal lag is slower

  const DT = 0.1;             // simulation step
  const MAX_DURATION = 120;   // hard stop, so a malformed profile can't hang

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  /**
   * Move `value` towards `target` — as a first-order lag, not a ramp that
   * stops dead when it arrives.
   *
   * This was a rate limiter (move by at most `rate * dt`, clamped at the
   * target) and that clamp is a CORNER: the value climbs in a straight line
   * and then turns flat in a single step, which is the kink that made these
   * curves look drawn rather than measured. Nothing in a group head does
   * that — a pump under control approaches its setpoint and never quite
   * arrives, so the curve eases in. Exponential approach has no corner at
   * either end by construction, and it is also the more honest model.
   *
   * `tau` is the time constant: ~63% of the way there in one tau, ~95% in
   * three. Derived from the old rates so the timing is unchanged in spirit —
   * a full-scale move still takes about a second.
   */
  function lag(value, target, tau, dt) {
    return value + (target - value) * (1 - Math.exp(-dt / tau));
  }

  /**
   * Resistance of a puck that has taken `inflowRatio` times what it can hold
   * (so 1.0 = nominally full), `brewT` seconds after it started brewing.
   *
   * The saturation term is `1 - exp(-x^k)` rather than a clamped `x^k`. Both
   * describe the same bed closing up as it fills, but the clamped version
   * stops rising the instant it reaches full — a corner in the resistance,
   * which shows up as a kink in BOTH the pressure and the flow curve at the
   * same moment. This one approaches its limit and never hits it, so the
   * shoulder is smooth.
   */
  function puckResistance(inflowRatio, brewT) {
    const x = Math.max(0, inflowRatio);
    const saturation = 1 - Math.exp(-Math.pow(x, SATURATION_EXP));
    const base = R_DRY + (R_WET - R_DRY) * saturation;
    const erosion = Math.min(EROSION_MAX, Math.max(0, brewT) * EROSION_PER_S);
    return Math.max(0.02, base * (1 - erosion));
  }

  function extractFrames(profile) {
    const frames = profile?.steps ?? profile?.frames ?? [];
    return Array.isArray(frames) ? frames : [];
  }

  /**
   * Has this frame's exit condition fired? `exitType` is the normalized form
   * from profile-edit's normalizeFrameExit: pressure_over / pressure_under /
   * flow_over / flow_under / weight.
   *
   * An "under" condition has to be ARMED before it can fire, and `armed` is
   * that latch: it goes true once the value has been above the threshold at
   * least once inside this frame. Both pressure and flow start at (or near)
   * zero, so "exit when pressure drops below 4 bar" is trivially true on
   * entry and would end the frame on its first step — the condition means
   * "having got there, once it falls back", and the latch is what says so.
   *
   * A settling TIME was the first attempt and it is the wrong tool: how long
   * a frame needs to clear its own threshold depends on the puck, the goal
   * and the slew rate, so any fixed window is a guess that a change in the
   * model quietly invalidates. This one cannot go stale.
   */
  function exitFired(f, armed, p, q, w) {
    if (!f.exitEnabled) return false;
    const v = num(f.exitValue);
    switch (f.exitType) {
      case "pressure_over": return p >= v;
      case "pressure_under": return armed.pressure && p <= v;
      case "flow_over": return q >= v;
      case "flow_under": return armed.flow && q <= v;
      case "weight": return w >= v;
      default: return false;
    }
  }

  /**
   * @param {object} profile - a profile record's `.profile` (or anything with
   *   `.steps` / `.frames`), exactly what renderProfileSpark takes.
   * @param {object} [opts]
   * @param {number} [opts.dose=18] - dry dose in g. Sets how much water the
   *   puck swallows before the first drop, so it moves the whole curve.
   * @param {number} [opts.dt=0.1] - simulation step in seconds.
   * @param {number} [opts.maxDuration=120]
   * @returns {{t:number[],pressure:number[],flow:number[],weight:number[],
   *            temperature:number[],targetPressure:(number|null)[],
   *            targetFlow:(number|null)[],
   *            stages:{idx:number,name:string,t0:number,t1:number}[],
   *            duration:number,dt:number}}
   *   `targetPressure` / `targetFlow` carry null wherever the frame does not
   *   command that variable — a caller drawing the goals must break its line
   *   there rather than plot a zero.
   */
  function simulateShot(profile, opts = {}) {
    const { dose = 18, dt = DT, maxDuration = MAX_DURATION } = opts;

    const raw = extractFrames(profile);
    const normalize = NSXCore.normalizeProfileFrame;
    const frames = raw.map((f) => (typeof normalize === "function" ? normalize(f) : f));

    const out = {
      t: [], pressure: [], flow: [], weight: [], temperature: [],
      targetPressure: [], targetFlow: [], stages: [], duration: 0, dt,
    };
    if (!frames.length) return out;

    // What the puck and the space around it hold before anything reaches the
    // cup — a little over the dose's own weight in water, which is why a spent
    // puck weighs about twice what went in. This is the whole reason the cup
    // stays empty through preinfusion.
    const absorbMl = Math.max(1, dose * 1.3);
    // A profile-level stop, if it has one. Frames have their own; this is the
    // shot's.
    const targetWeight = Math.max(0, num(profile?.target_weight, 0));

    let t = 0;
    let p = 0;          // bar at the group
    let q = 0;          // ml/s through the puck
    let pMid = 0;       // the intermediate state of the two-stage lag...
    let qMid = 0;       // ...one per quantity; see PRESSURE_TAU
    let temp = num(frames[0]?.temperature, 93);
    let inflow = 0;     // ml pumped in total
    let cupWeight = 0;  // g in the cup
    let brewT = 0;      // seconds since the puck saturated

    for (let i = 0; i < frames.length && t < maxDuration; i++) {
      const f = frames[i];
      const dur = Math.max(0.1, num(f.seconds, 0));
      const isFlowFrame = f.pump === "flow";
      // "smooth" ramps from wherever the previous frame actually left the
      // machine, NOT from the previous frame's goal: if the puck never let it
      // reach 9 bar, the ramp starts from the 7 it really had.
      const fromP = p;
      const fromQ = q;
      const goalP = clamp(num(f.pressure, 0), 0, PUMP_MAX_PRESSURE);
      const goalQ = clamp(num(f.flow, 0), 0, PUMP_MAX_FLOW);
      const goalTemp = num(f.temperature, temp);
      const frameStartInflow = inflow;
      const frameStartWeight = cupWeight;

      const stage = { idx: i, name: String(f.name || `Step ${i + 1}`), t0: t, t1: t };
      let e = 0; // elapsed inside this frame
      // Per frame, not per shot: each frame's exit waits for ITS own rise.
      const armed = { pressure: false, flow: false };

      while (e < dur && t < maxDuration) {
        const ramp = f.transition === "smooth" ? Math.min(1, e / dur) : 1;
        const targetP = fromP + (goalP - fromP) * ramp;
        const targetQ = fromQ + (goalQ - fromQ) * ramp;

        const R = puckResistance(inflow / absorbMl, brewT);

        // Where the pair WANTS to be this instant. Only one of the two is
        // commanded; the puck's R fixes the other, and a limiter can override
        // whichever one it guards.
        let pWant;
        let qWant;
        if (isFlowFrame) {
          // The pump chases a flow; the puck decides what pressure that costs.
          qWant = Math.min(targetQ, PUMP_MAX_FLOW);
          pWant = clamp(qWant * qWant * R, 0, PUMP_MAX_PRESSURE);
          // A pressure limiter here is a ceiling on that cost: hit it and the
          // machine gives up flow rather than push harder.
          if (f.limiterEnabled && f.limiterValue > 0 && pWant > f.limiterValue) {
            pWant = f.limiterValue;
            qWant = Math.sqrt(pWant / R);
          }
        } else {
          // The pump chases a pressure; the puck decides what flows.
          pWant = Math.min(targetP, PUMP_MAX_PRESSURE);
          qWant = Math.sqrt(pWant / R);
          // A flow limiter is the mirror image: cap the flow and the pressure
          // that survives is whatever that flow can push through the puck.
          if (f.limiterEnabled && f.limiterValue > 0 && qWant > f.limiterValue) {
            qWant = f.limiterValue;
            pWant = clamp(qWant * qWant * R, 0, PUMP_MAX_PRESSURE);
          }
          if (qWant > PUMP_MAX_FLOW) {
            qWant = PUMP_MAX_FLOW;
            pWant = clamp(qWant * qWant * R, 0, PUMP_MAX_PRESSURE);
          }
        }

        // ...and both get there through the same lag, whichever one the frame
        // commands. That is not just tidiness. Setting the derived variable
        // algebraically while filtering the commanded one puts a corner at
        // every frame boundary that switches control mode — pressure was being
        // filtered in a pressure frame and snapped in a flow frame, so the
        // handover between them was a visible kink. Physically the group has
        // compliance: water is slightly compressible and the head has volume,
        // so neither quantity jumps when the controller changes its mind.
        pMid = lag(pMid, pWant, PRESSURE_TAU, dt);
        p = lag(p, pMid, PRESSURE_TAU, dt);
        qMid = lag(qMid, qWant, FLOW_TAU, dt);
        q = lag(q, qMid, FLOW_TAU, dt);

        temp = lag(temp, goalTemp, TEMP_TAU, dt);
        inflow += q * dt;
        // Nothing leaves the puck until it has stopped filling. After that,
        // what goes in comes out (ml of water ~ g of espresso, close enough at
        // this resolution).
        if (inflow >= absorbMl) {
          cupWeight += q * dt;
          brewT += dt;
        }

        t += dt;
        e += dt;
        out.t.push(Number(t.toFixed(3)));
        out.pressure.push(Number(p.toFixed(3)));
        out.flow.push(Number(q.toFixed(3)));
        out.weight.push(Number(cupWeight.toFixed(3)));
        out.temperature.push(Number(temp.toFixed(2)));
        // The goals, but only the one this frame actually commands — the other
        // is null so a caller breaks the line instead of drawing a zero.
        out.targetPressure.push(isFlowFrame ? null : Number(targetP.toFixed(3)));
        out.targetFlow.push(isFlowFrame ? Number(targetQ.toFixed(3)) : null);

        // Everything that can cut a frame short, in the order the machine
        // checks them.
        const exitV = num(f.exitValue);
        if (p > exitV) armed.pressure = true;
        if (q > exitV) armed.flow = true;
        if (exitFired(f, armed, p, q, cupWeight)) break;
        if (f.weightEnabled && f.weightValue > 0 && cupWeight - frameStartWeight >= f.weightValue) break;
        if (f.volumeEnabled && f.volumeValue > 0 && inflow - frameStartInflow >= f.volumeValue) break;
        if (targetWeight > 0 && cupWeight >= targetWeight) break;
      }

      stage.t1 = t;
      out.stages.push(stage);
      if (targetWeight > 0 && cupWeight >= targetWeight) break;
    }

    out.duration = t;
    return out;
  }

  NSXCore.register({ simulateShot });
})();
