"use strict";
/**
 * NSXCore profile-render domain — pure SVG rendering of a profile's pressure /
 * flow / temperature curve. Owns no state (same category as mapping.js): every
 * call is a pure function of its arguments.
 *
 * Ported from NSX's `_profileSparkSvg` (packages/nsx/src/modules/app.js) so a
 * second skin (Nova) gets byte-identical curves instead of re-deriving the SVG
 * math. The one behavioral change from the original: NSX read light/dark theme
 * via `document.documentElement.dataset.theme` — core has no DOM access, so
 * that becomes an explicit `theme` option (default "dark"). Any skin using this
 * (a profile picker's preview pane, a profile manager, a recipe editor) should
 * render the same markup structure/class names, or restyle the *.profile-spark*
 * classes to taste — the class names are just styling hooks, nothing behavioral
 * depends on them.
 *
 * Registered on NSXCore:
 *   renderProfileSpark(profile, opts?) -> string (SVG markup, or a placeholder
 *     <div> if the profile has no frames)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.profile-render] core.js must load before domains/profile-render.js");
    return;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function extractFrames(profile) {
    const frames = profile?.steps ?? profile?.frames ?? [];
    return Array.isArray(frames) ? frames : [];
  }

  /**
   * @param {object} profile - a profile record's `.profile` (or the profile itself
   *   if it already has `.steps`/`.frames`).
   * @param {object} [opts]
   * @param {"dark"|"light"} [opts.theme="dark"]
   * @param {boolean} [opts.showXTicks=true]
   * @param {boolean} [opts.showYTicks=true]
   * @param {boolean} [opts.showStageLabels=true]
   * @param {number}  [opts.legendFontSize=10]
   * @param {boolean} [opts.centerLegend=false]
   * @param {number}  [opts.lineStrokeWidth=2.2]
   * @param {boolean} [opts.compactMargins=false]
   * @param {boolean} [opts.showLegend=true]
   * @param {boolean} [opts.showTempLine=true]
   * @param {number}  [opts.selectedFrameIdx=-1]
   * @param {number}  [opts.tickFontSize=11]
   * @param {string}  [opts.emptyLabel="No profile data"]
   * @param {number}  [opts.pressureMax] - fixed pressure/flow axis ceiling; omit
   *   for the default auto-scaled-to-the-profile's-peak behavior.
   * @param {boolean} [opts.simulate=true] - draw a simulated shot (see
   *   domains/profile-simulate.js) instead of the frames' goals as rectangles.
   *   Falls back to the old step plot on its own if simulateShot is not loaded.
   * @param {boolean} [opts.showGoals=true] - with `simulate`, also draw the
   *   commanded goal behind the simulated curve, dashed — and only for the
   *   variable each frame actually commands.
   * @param {number}  [opts.dose=18] - dry dose in g, passed to the simulation.
   */
  function renderProfileSpark(profile, opts = {}) {
    const {
      theme = "dark",
      showXTicks = true,
      showYTicks = true,
      showStageLabels = true,
      legendFontSize = 10,
      centerLegend = false,
      lineStrokeWidth = 2.2,
      compactMargins = false,
      showLegend = true,
      showTempLine = true,
      selectedFrameIdx = -1,
      tickFontSize = 11,
      emptyLabel = "No profile data",
      pressureMax: pressureMaxOverride,
      simulate = true,
      showGoals = true,
      dose = 18,
    } = opts;

    const frames = extractFrames(profile);
    if (!frames.length) {
      return `<div class="profile-picker-placeholder">${escapeHtml(emptyLabel)}</div>`;
    }

    const isLight = theme === "light";
    const clr = {
      bg:            isLight ? "#ffffff"              : "rgba(0,0,0,0.22)",
      grid:          isLight ? "rgba(0,0,0,0.12)"      : "rgba(255,255,255,0.10)",
      plotFill:      isLight ? "rgba(0,0,0,0.02)"      : "rgba(255,255,255,0.02)",
      plotStroke:    isLight ? "rgba(0,0,0,0.12)"      : "rgba(255,255,255,0.10)",
      tickText:      isLight ? "rgba(60,60,67,0.60)"   : "rgba(235,235,245,0.55)",
      xTickText:     isLight ? "rgba(60,60,67,0.70)"   : "rgba(235,235,245,0.65)",
      xTickLine:     isLight ? "rgba(0,0,0,0.18)"      : "rgba(255,255,255,0.18)",
      legendText:    isLight ? "rgba(0,0,0,0.75)"      : "rgba(235,235,245,0.82)",
      stageBandOdd:  isLight ? "rgba(0,0,0,0.03)"      : "rgba(255,255,255,0.035)",
      stageBandEven: isLight ? "rgba(0,0,0,0.015)"     : "rgba(255,255,255,0.02)",
      stageLabel:    isLight ? "rgba(0,0,0,0.80)"      : "rgba(235,235,245,0.85)",
      stageSep:      isLight ? "rgba(0,0,0,0.10)"      : "rgba(255,255,255,0.11)",
    };

    const width = 680;
    const height = 274;
    const plotLeft = compactMargins ? 10 : 44;
    const plotRight = compactMargins ? 10 : 50;
    const plotTop = compactMargins ? 10 : 78;
    const plotBottom = compactMargins ? 8 : 26;
    const plotW = width - plotLeft - plotRight;
    const plotH = height - plotTop - plotBottom;
    // The temp band only needs to be carved out of the plot when a temp line
    // is actually drawn — otherwise pressure/flow get the full height instead
    // of leaving a dead reserved strip above them.
    const tempBandH = showTempLine ? Math.floor(plotH / 3) : 0;
    const pfBandH = plotH - tempBandH;
    const pfBandTop = plotTop + tempBandH;

    // The simulated shot, if it is wanted and available. Guarded rather than
    // assumed: profile-simulate.js is a separate core file, and a skin that has
    // not registered it yet must still get a chart rather than an exception —
    // it simply falls back to the goal rectangles this renderer always drew.
    const sim = simulate && typeof NSXCore.simulateShot === "function"
      ? NSXCore.simulateShot(profile, { dose })
      : null;
    const hasSim = Boolean(sim && sim.t.length > 1);

    const pressureValues = frames.map((f) => Number(f?.pressure)).filter(Number.isFinite);
    const flowValues = frames.map((f) => Number(f?.flow)).filter(Number.isFinite);
    const tempValues = frames.map((f) => Number(f?.temperature)).filter(Number.isFinite);

    // The ceiling has to contain what is DRAWN, not just what is commanded: a
    // flow frame's pressure is the puck's answer and can sit above every goal
    // in the profile, and preinfusion flow on a dry bed routinely does.
    const simPeak = hasSim ? Math.max(...sim.pressure, ...sim.flow) : 0;
    const maxPressureRaw = Math.max(pressureValues.length ? Math.max(...pressureValues, 0) : 0, simPeak);
    const minTempRaw = tempValues.length ? Math.min(...tempValues) : 88;
    const maxTempRaw = tempValues.length ? Math.max(...tempValues) : 94;

    const pressureMax = Number.isFinite(pressureMaxOverride) && pressureMaxOverride > 0
      ? pressureMaxOverride
      : Math.max(8, Math.ceil((maxPressureRaw + 1) / 2.5) * 4);

    const tempMin = Math.max(70, Math.floor(minTempRaw - 1));
    const tempMaxCandidate = Math.min(105, Math.ceil(maxTempRaw + 1));
    const tempMax = Math.max(tempMin + 6, tempMaxCandidate);

    // The x axis is the shot's REAL length when simulating. That is not a
    // detail: exit conditions, weight and volume targets routinely end a frame
    // long before its `seconds`, so the sum of the frames' durations is an
    // upper bound the machine often never reaches. Drawing against it stretched
    // every profile with an exit condition across a timeline that never
    // happened.
    let totalT;
    if (hasSim) {
      totalT = Math.max(sim.duration, 1);
    } else {
      totalT = 0;
      for (const f of frames) totalT += Math.max(0.1, Number(f?.seconds || 0));
      totalT = Math.max(totalT, 1);
    }
    const xAt = (t) => plotLeft + (Math.max(0, Math.min(totalT, t)) / totalT) * plotW;

    let stageT = 0;
    const stageSegments = frames.map((f, idx) => {
      // Simulated stages carry the time the frame actually took; without a
      // simulation they fall back to the time it asked for.
      const simStage = hasSim ? sim.stages[idx] : null;
      const t0 = simStage ? simStage.t0 : stageT;
      const t1 = simStage ? simStage.t1 : stageT + Math.max(0.1, Number(f?.seconds || 0));
      stageT = t1;
      return {
        x0: xAt(t0),
        x1: xAt(t1),
        label: String(f?.name || `Step ${idx + 1}`),
        odd: idx % 2 === 1,
        isLast: idx === frames.length - 1,
      };
    });

    const yPressure = (value) => {
      const v = Number.isFinite(value) ? Math.max(0, Math.min(pressureMax, value)) : 0;
      return pfBandTop + (1 - v / pressureMax) * pfBandH;
    };
    const yFlow = yPressure; // flow and pressure share the same band/scale, as in NSX
    const yTemp = (value) => {
      const v = Number.isFinite(value) ? Math.max(tempMin, Math.min(tempMax, value)) : tempMin;
      return plotTop + 3 + (1 - (v - tempMin) / (tempMax - tempMin)) * (tempBandH - 6);
    };

    const toStepPoints = (valueGetter, yMap) => {
      let t = 0;
      const pts = [];
      for (const f of frames) {
        const seg = Math.max(0.1, Number(f?.seconds || 0));
        const v = valueGetter(f);
        const y = yMap(v);
        pts.push(`${xAt(t).toFixed(2)},${y.toFixed(2)}`);
        pts.push(`${xAt(t + seg).toFixed(2)},${y.toFixed(2)}`);
        t += seg;
      }
      return pts.join(" ");
    };

    /**
     * A simulated series as a SMOOTH path.
     *
     * Two reasons this is a <path> and not a <polyline>. The obvious one: a
     * polyline through 0.1s samples is a chain of straight segments, and every
     * bend in the curve is a visible corner. The other is size — a 30s shot is
     * 300 samples per series, and with three series plus goals that is a lot
     * of SVG for a thumbnail. Fitting a curve lets us DROP most of the samples
     * and still come out smoother than the dense polyline was.
     *
     * The fit is Catmull-Rom converted to cubic beziers — control points at
     * a sixth of the neighbours' span, which is the standard construction and
     * exactly what ShotStripChart.vue already draws real shots with. Same
     * curve for a simulated shot and a measured one, which matters: the two
     * appear in the same app and must not look like different kinds of thing.
     */
    const toSmoothPath = (values, yMap) => {
      // Aim for ~110 points regardless of shot length. Below about that the
      // fit starts cutting corners off real features (the flow spike as the
      // puck fills is only a second or so wide); above it, nothing is gained.
      const stride = Math.max(1, Math.round(values.length / 110));
      const pts = [];
      for (let i = 0; i < values.length; i += stride) {
        pts.push([xAt(sim.t[i]), yMap(values[i])]);
      }
      // Always land on the true last sample: a stride that doesn't divide
      // evenly would otherwise stop the curve short of the shot's end.
      const lastI = values.length - 1;
      if ((lastI % stride) !== 0) pts.push([xAt(sim.t[lastI]), yMap(values[lastI])]);
      if (pts.length < 2) return "";

      let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
      }
      return d;
    };

    /**
     * A GOAL series as polylines — straight, deliberately. A goal is not a
     * measurement: the machine was told to hold 9 bar, or to ramp there in a
     * line, and smoothing that would invent a curve nobody commanded. The
     * simulated answer bends; the instruction behind it does not.
     *
     * These carry null wherever the frame does not
     * command that variable, and a null must break the line rather than plot as
     * zero — otherwise a pressure profile's goal line would dive to the floor
     * for the length of every flow frame and climb back out, which is exactly
     * the invented data this whole change is removing. So: one polyline per
     * run of consecutive non-null samples.
     */
    const toGoalSegments = (values, yMap) => {
      const runs = [];
      let cur = [];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v == null) {
          if (cur.length > 1) runs.push(cur.join(" "));
          cur = [];
          continue;
        }
        cur.push(`${xAt(sim.t[i]).toFixed(2)},${yMap(v).toFixed(2)}`);
      }
      if (cur.length > 1) runs.push(cur.join(" "));
      return runs;
    };

    // One curve element, however it was built: a fitted <path> for a simulated
    // series, the original <polyline> for the step plot's rectangles.
    const curveEl = (simValues, stepGetter, yMap, stroke) => {
      const shared = `fill="none" stroke="${stroke}" stroke-width="${lineStrokeWidth}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"`;
      if (hasSim) return `<path d="${toSmoothPath(simValues, yMap)}" ${shared}></path>`;
      return `<polyline points="${toStepPoints(stepGetter, yMap)}" ${shared}></polyline>`;
    };
    const pressureEl = curveEl(hasSim ? sim.pressure : null, (f) => Number(f?.pressure), yPressure, "#17c29a");
    const flowEl = curveEl(hasSim ? sim.flow : null, (f) => Number(f?.flow), yFlow, "#7aaaff");
    const tempEl = curveEl(hasSim ? sim.temperature : null, (f) => Number(f?.temperature), yTemp, "#ff7a84");
    const goalRuns = hasSim && showGoals
      ? [
          ...toGoalSegments(sim.targetPressure, yPressure).map((pts) => ({ pts, stroke: "#17c29a" })),
          ...toGoalSegments(sim.targetFlow, yFlow).map((pts) => ({ pts, stroke: "#7aaaff" })),
        ]
      : [];

    const gridLines = [];
    const leftTicks = [];
    for (let i = 0; i <= 3; i++) {
      const v = (pressureMax / 3) * i;
      const y = yPressure(v);
      gridLines.push(`<line x1="${plotLeft}" y1="${y.toFixed(2)}" x2="${(plotLeft + plotW).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${clr.grid}" stroke-width="1"></line>`);
      leftTicks.push(`<text x="${(plotLeft - 8).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end" fill="${clr.tickText}" font-size="${tickFontSize}">${v.toFixed(0)}</text>`);
    }

    const rightTicks = [];
    const tempTickVals = [tempMin, (tempMin + tempMax) / 2, tempMax];
    for (const v of tempTickVals) {
      const y = yTemp(v);
      rightTicks.push(`<text x="${(plotLeft + plotW + 8).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="start" fill="${clr.tickText}" font-size="${tickFontSize}">${v.toFixed(0)}</text>`);
    }

    const xAxisLine = `<line x1="${plotLeft}" y1="${plotTop + plotH}" x2="${(plotLeft + plotW).toFixed(2)}" y2="${plotTop + plotH}" stroke="${clr.xTickLine}" stroke-width="1.5"></line>`;
    const xAxisY = plotTop + plotH;
    const xTickLabels = [];
    const xTickCount = Math.min(10, Math.max(6, Math.round(totalT / 4) + 1));
    for (let i = 0; i < xTickCount; i++) {
      const ratio = xTickCount <= 1 ? 0 : i / (xTickCount - 1);
      const tSec = totalT * ratio;
      const x = plotLeft + ratio * plotW;
      const lbl = totalT < 30 ? tSec.toFixed(1).replace(/\.0$/, "") : tSec.toFixed(0);
      xTickLabels.push(`<text x="${x.toFixed(2)}" y="${(xAxisY + 16).toFixed(2)}" text-anchor="middle" fill="${clr.xTickText}" font-size="${tickFontSize}">${lbl}s</text>`);
    }

    const stageBands = [];
    const stageLabels = [];
    const stageSeparators = [];
    const labelStripTop = Math.min(28, plotTop - 2);
    const labelStripH = Math.max(0, plotTop - labelStripTop - 2);
    for (let idx = 0; idx < stageSegments.length; idx++) {
      const seg = stageSegments[idx];
      const w = Math.max(0, seg.x1 - seg.x0);
      if (labelStripH > 0) {
        stageBands.push(`<rect x="${seg.x0.toFixed(2)}" y="${labelStripTop}" width="${w.toFixed(2)}" height="${labelStripH}" fill="${seg.odd ? clr.stageBandOdd : clr.stageBandEven}"></rect>`);
      }
      const cx = seg.x0 + w / 2;
      const isEdge = idx === 0 || idx === stageSegments.length - 1;
      const shouldShowLabel = w >= 20 || (isEdge && w >= 10);
      if (shouldShowLabel) {
        const maxLen = w < 28 ? 6 : w < 38 ? 10 : 18;
        const safeLabel = escapeHtml(seg.label.length > maxLen ? `${seg.label.slice(0, maxLen)}...` : seg.label);
        const labelY = labelStripTop + (idx % 2 === 0 ? 16 : 36);
        stageLabels.push(`<text x="${cx.toFixed(2)}" y="${labelY}" text-anchor="middle" fill="${clr.stageLabel}" font-size="${tickFontSize}">${safeLabel}</text>`);
      }
      if (!seg.isLast) {
        stageSeparators.push(`<line x1="${seg.x1.toFixed(2)}" y1="${labelStripTop}" x2="${seg.x1.toFixed(2)}" y2="${(plotTop + plotH).toFixed(2)}" stroke="${clr.stageSep}" stroke-width="1"></line>`);
      }
    }

    const legendY = 16;
    const charW = legendFontSize * 0.62;
    const lineLen = 14;
    const lineGap = 4;
    const legGap = 20;
    const leg1W = lineLen + lineGap + Math.ceil("Pressure (bar)".length * charW);
    const leg2W = lineLen + lineGap + Math.ceil("Flow (ml/s)".length * charW);
    const leg3W = lineLen + lineGap + Math.ceil("Temp (°C)".length * charW);
    const legendTotalW = leg1W + legGap + leg2W + legGap + leg3W;
    const legendStartX = centerLegend ? Math.round(plotLeft + plotW / 2 - legendTotalW / 2) : 18;
    const l2x = legendStartX + leg1W + legGap;
    const l3x = l2x + leg2W + legGap;

    return `
    <div class="profile-spark-wrap">
      <svg class="profile-spark" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="${compactMargins ? "none" : "xMidYMid meet"}" aria-hidden="true">
        <rect x="0" y="0" width="${width}" height="${height}" rx="12" ry="12" fill="${clr.bg}"></rect>
        ${showLegend ? `
        <line x1="${legendStartX}" y1="${legendY}" x2="${legendStartX + lineLen}" y2="${legendY}" stroke="#17c29a" stroke-width="2.2"></line>
        <text x="${legendStartX + lineLen + lineGap}" y="${legendY + 3}" fill="${clr.legendText}" font-size="${legendFontSize}">Pressure (bar)</text>
        <line x1="${l2x}" y1="${legendY}" x2="${l2x + lineLen}" y2="${legendY}" stroke="#7aaaff" stroke-width="2.2"></line>
        <text x="${l2x + lineLen + lineGap}" y="${legendY + 3}" fill="${clr.legendText}" font-size="${legendFontSize}">Flow (ml/s)</text>
        <line x1="${l3x}" y1="${legendY}" x2="${l3x + lineLen}" y2="${legendY}" stroke="#ff7a84" stroke-width="2.2"></line>
        <text x="${l3x + lineLen + lineGap}" y="${legendY + 3}" fill="${clr.legendText}" font-size="${legendFontSize}">Temp (°C)</text>
        ` : ""}

        ${stageBands.join("")}
        ${stageSeparators.join("")}
        ${showStageLabels ? stageLabels.join("") : ""}
        ${selectedFrameIdx >= 0 && stageSegments[selectedFrameIdx] ? (() => {
          const s = stageSegments[selectedFrameIdx];
          return `<rect x="${s.x0.toFixed(2)}" y="${plotTop}" width="${(s.x1 - s.x0).toFixed(2)}" height="${plotH}" fill="rgba(10,132,255,0.18)" rx="2"></rect>`;
        })() : ""}

        <rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}" fill="${clr.plotFill}" stroke="${clr.plotStroke}" stroke-width="1"></rect>
        ${showTempLine ? `<line x1="${plotLeft}" y1="${pfBandTop.toFixed(2)}" x2="${(plotLeft + plotW).toFixed(2)}" y2="${pfBandTop.toFixed(2)}" stroke="${clr.stageSep}" stroke-width="1" stroke-dasharray="4,3"></line>` : ""}
        ${gridLines.join("")}
        ${showYTicks ? leftTicks.join("") : ""}
        ${showYTicks ? rightTicks.join("") : ""}
        ${showXTicks ? xAxisLine : ""}

        ${goalRuns.map((g) => `<polyline points="${g.pts}" fill="none" stroke="${g.stroke}" stroke-width="${lineStrokeWidth}" stroke-dasharray="5,4" opacity="0.42" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>`).join("")}
        ${pressureEl}
        ${flowEl}
        ${showTempLine ? tempEl : ""}
        ${showXTicks ? xTickLabels.join("") : ""}
      </svg>
    </div>`;
  }

  NSXCore.register({ renderProfileSpark });
})();
