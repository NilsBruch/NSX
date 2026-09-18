<script setup>
/**
 * Shot strip chart — shared canvas renderer for both the live shot and shot
 * history. Two modes:
 *  - 'scroll' (live): a fixed windowS-second viewport that scrolls left at
 *    constant wall-clock speed (rAF against originMs), oscilloscope-style. New
 *    data always surfaces at the RIGHT edge and drifts across, so the
 *    perceived motion is 60fps-smooth no matter that samples only arrive
 *    every ~250ms.
 *  - 'static' (history): the WHOLE shot mapped across the full canvas width,
 *    motionless — same encodings, same colors, just windowS = the shot's own
 *    duration instead of a fixed 35s and no scrolling.
 * (The pre-strip-chart approach — x-axis spanning the whole live shot — both
 * stepped on every tick AND kept compressing the curve as the shot ran long.)
 *
 * ── Normal encodings (skinSettings.graphMode === 'normal') ─────────────────
 *  - flow        -> blue bars, averaged over BIN_S bins
 *  - flow goal   -> empty (outlined) bars in the same bins
 *  - weight flow -> brown fill painted over each bar from the bottom;
 *                   in == out ⇒ the bar reads fully brown
 *  - pressure    -> solid curve;  pressure goal -> dashed curve
 * Both GOAL encodings are optional -- the `showTargets` prop drops them, on a
 * skin setting, leaving only what the machine actually did.
 * Temperature is deliberately NOT plotted here — it lives in the metric tiles;
 * the normal strip chart is about extraction dynamics on the shared 0-12 scale.
 *
 * ── Expert encodings (skinSettings.graphMode === 'expert') ─────────────────
 * The reading instrument rather than the glanceable strip: every series is a
 * LINE in NSX's own chart colours (see packages/nsx/src/modules/ui.js's
 * CHART_COLORS — this view is a port of that one, which is what was asked
 * for), the plot gets real axes with numbers (time along the bottom, the
 * shared 0-12 pressure/flow scale on the left, temperature on its own
 * right-hand scale), and the legend above it becomes a set of toggles: tap a
 * series to drop it out of the plot, tap Goals to show or hide every target
 * curve at once.
 *
 * Both modes are the same renderer on purpose — same data, same geometry
 * helpers, same scrubbing — so a shot looks like itself in either one and
 * there is no second chart component to keep in step. Which one a chart draws
 * is the caller's `expert` prop, from the skin setting.
 *
 * Replaces the old ShotGraph.vue (uPlot) for both live and history: a
 * scrolling viewport with painted-over bars isn't a uPlot shape, and
 * hand-rolled canvas is less code than fighting the library's plugin hooks —
 * and using the SAME renderer for both means history looks exactly like the
 * live shot it was recorded from, just uncompressed across the full width.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
// Named apart from this file's own tempRange(), which is the axis SCALE in
// Celsius, not a unit conversion.
import { dispTemp, tempUnitLabel } from '../composables/useUnits.js';

const props = defineProps({
  // { elapsed, pressure, targetPressure, flow, targetFlow, weightFlow } —
  // parallel arrays; expert mode also reads `temperature` (and
  // `targetTemperature` where the caller has it) for the right-hand scale.
  series: { type: Object, required: true },
  mode: { type: String, default: 'scroll' }, // 'scroll' | 'static'
  originMs: { type: Number, default: 0 },    // scroll mode: Date.now() at elapsed=0
  windowS: { type: Number, default: 35 },    // scroll mode: seconds visible in the viewport
  // true = also draw the profile's target pressure curve and target flow bars.
  // Off by default here too, matching the skin setting that drives it
  // (SkinPanel) — a caller that passes nothing gets the plain plot. In expert
  // mode this is only the STARTING state of the legend's own Goals toggle.
  showTargets: { type: Boolean, default: false },
  // true = the axes-and-lines rendering described above.
  expert: { type: Boolean, default: false },
  // Scroll mode: the temperature the shot is brewed at (°C), known before the
  // first sample. Fixes the right-hand scale for the whole shot — see
  // tempRange(). Without it a live chart falls back to fitting the data.
  tempAnchor: { type: Number, default: null },
  // Scroll mode: the shot is over. The viewport stops where it was instead of
  // scrolling on into time where nothing more will arrive.
  stopped: { type: Boolean, default: false },
});

// The viewport's right edge at the moment `stopped` came on, in shot-elapsed
// seconds — the wall-clock `now` frozen, NOT the last sample's time: snapping
// back to the last sample would visibly jerk the curve right by however long
// the final sample was ago.
let frozenNow = null;
watch(() => props.stopped, (on) => {
  frozenNow = on ? (Date.now() - props.originMs) / 1000 : null;
});
// Touch-and-hold scrubbing (static/history mode only): emits the sample under
// the finger so the legend can read out pressure/flow/weight-flow at that point,
// null when released. Live mode never scrubs (it's still moving).
const emit = defineEmits(['scrub']);
const cursorIdx = ref(null); // index into series.* while scrubbing, else null

const { t } = useI18n();

const BIN_S = 0.5; // flow-bar averaging bin ("schmale Balken")
const MAX_Y = 12;  // shared pressure/flow scale — same fixed 0-12 as the old ShotGraph

// Chart-internal colors; the legend swatches in LiveShotOverlay must match.
const COLORS = {
  flow: 'rgba(127, 168, 201, 0.5)',        // #7fa8c9
  flowGoal: 'rgba(127, 168, 201, 0.75)',
  weight: '#ad7648',
  pressure: '#5fb8a5',
  pressureGoal: 'rgba(95, 184, 165, 0.45)',
  // Fallbacks only. These two are the ones that depend on the GROUND rather
  // than on the series they draw, so they are read from the theme's tokens at
  // draw time (themeColor below) — the series colours themselves are mid-tones
  // that hold up on either.
  grid: 'rgba(233, 237, 242, 0.05)',
  scrub: 'rgba(233, 237, 242, 0.5)',
};

// Expert mode's palette, copied value-for-value from NSX's CHART_COLORS so the
// two skins' expert plots are the same picture. Each goal is a lighter twin of
// its own series rather than one shared "target" grey, so a dashed line reads
// as belonging to the curve it shadows.
const X_COLORS = {
  pressure: '#18b890', pressureGoal: '#5cd4a8',
  flow: '#4878e8', flowGoal: '#6e9af0',
  temperature: '#e8495a', temperatureGoal: '#e88a94',
  weight: '#c08840',
};

// Which series the expert legend is currently showing. Per chart instance (the
// live view and the history view each keep their own), and a toggle holds for
// as long as that view is open.
const shown = reactive({
  pressure: true, flow: true, weight: true, temperature: true, goals: props.showTargets,
});
// The skin setting seeds Goals; flipping it in settings re-seeds it here rather
// than fighting whatever the legend was last left on.
watch(() => props.showTargets, (v) => { shown.goals = v; });

const LEGEND = [
  { key: 'pressure', color: X_COLORS.pressure, label: 'liveShot.mPressure', unit: 'bar' },
  { key: 'flow', color: X_COLORS.flow, label: 'liveShot.mFlow', unit: 'ml/s' },
  { key: 'weight', color: X_COLORS.weight, label: 'liveShot.mWflow', unit: 'g/s' },
  // No unit here: the temperature one follows the skin's setting, so the
  // template reads tempUnitLabel for this row. A ref parked in a plain array
  // would not unwrap in the template anyway.
  { key: 'temperature', color: X_COLORS.temperature, label: 'liveShot.mTemp', unit: '' },
];

/** The scrubbed sample's value per legend entry, so the expert legend doubles
 *  as the readout the caller's own caption gives in normal mode. */
const scrubbed = computed(() => {
  const i = cursorIdx.value;
  if (i == null) return null;
  const s = props.series;
  return {
    pressure: s.pressure?.[i], flow: s.flow?.[i],
    weight: s.weightFlow?.[i], temperature: s.temperature?.[i],
  };
});
const fmtLegend = (v, dec) => (Number.isFinite(v) ? v.toFixed(dec) : '—');

/** A CSS custom property's current value, so the canvas follows the theme the
 *  rest of the skin is painted in. Read per draw: cheap next to the drawing
 *  itself, and it means a theme switch needs no invalidation plumbing. */
function themeColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const wrap = ref(null);
const cv = ref(null);
let ctx = null;
let raf = 0;

/** Plot geometry for the current frame. Normal mode plots edge to edge; expert
 *  mode insets the axis gutters. Shared by draw() and scrubAt() so a held
 *  finger lands on the sample it is actually over in either mode. */
function geometry(w, h) {
  const px = props.expert ? 38 : 0;
  const py = props.expert ? 10 : 0;
  const pw = Math.max(1, w - px - (props.expert ? 46 : 0));
  const ph = Math.max(1, h - py - (props.expert ? 22 : 0));
  const ts = props.series.elapsed, n = ts.length;
  const live = props.mode === 'scroll';
  // `now` = the right edge of the viewport in shot-elapsed seconds. Live:
  // real wall-clock elapsed, until the shot has stopped — then held where it
  // was, so saving the shot (which can take a few seconds) doesn't scroll the
  // finished curve off to the left. Static: the shot's own last sample — the
  // whole duration fills the canvas exactly once, no scroll.
  const now = live
    ? (frozenNow ?? (Date.now() - props.originMs) / 1000)
    : (n ? ts[n - 1] : 0);
  const span = live ? props.windowS : Math.max(now, 1);
  const pps = pw / span;
  return {
    px, py, pw, ph, live, now, span, pps,
    xFor: (t) => px + pw - (now - t) * pps,
    yFor: (v) => py + ph - (Math.min(Math.max(v, 0), MAX_Y) / MAX_Y) * ph,
  };
}

/** The right-hand temperature scale. Snapped to 5° boundaries with at least a
 *  10° span.
 *
 *  A LIVE shot does not fit its data. Fitting is right for a finished shot
 *  (every value is in, the range is computed once and stays), but live it is
 *  recomputed every frame from a series that keeps growing — the dip at the
 *  start of preinfusion, then the climb back — so the axis re-scaled itself
 *  mid-shot and every curve on it jumped. Live, the scale comes from the
 *  brewing temperature instead, which is known before the first sample, and
 *  never moves. The band sits mostly BELOW the anchor, because that is where a
 *  shot spends its time: the puck and the incoming water pull the reading
 *  down from the setpoint. A reading outside it is pinned to the edge (see
 *  yTemp) rather than widening the axis. */
function tempRange() {
  if (props.mode === 'scroll' && Number.isFinite(props.tempAnchor) && props.tempAnchor > 0) {
    const lo = Math.floor((props.tempAnchor - 8) / 5) * 5;
    const hi = Math.ceil((props.tempAnchor + 4) / 5) * 5;
    return [lo, Math.max(hi, lo + 10)];
  }
  const arr = props.series.temperature || [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [80, 100];
  lo = Math.floor((lo - 2) / 5) * 5;
  hi = Math.ceil((hi + 2) / 5) * 5;
  if (hi - lo < 10) hi = lo + 10;
  return [lo, hi];
}

/** Seconds between x-axis labels: at most ~6 across the plot, from a set of
 *  round intervals so the numbers stay ones a person reads as times. */
function timeStep(span) {
  for (const step of [5, 10, 15, 20, 30, 60, 120]) {
    if (span / step <= 6) return step;
  }
  return 300;
}

function draw() {
  raf = requestAnimationFrame(draw);
  const el = wrap.value;
  if (!ctx || !el) return;
  const dpr = window.devicePixelRatio || 1;
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  if (cv.value.width !== Math.round(w * dpr) || cv.value.height !== Math.round(h * dpr)) {
    cv.value.width = Math.round(w * dpr);
    cv.value.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const ts = props.series.elapsed, n = ts.length;
  const g = geometry(w, h);
  const { live, now, span, xFor, yFor } = g;
  const windowStart = live ? now - span - BIN_S : -Infinity;
  const gridColor = themeColor('--chart-grid', COLORS.grid);

  if (props.expert) drawExpert(g, gridColor, windowStart);
  else drawNormal(g, gridColor, windowStart, w, h);

  // ── Scrub cursor (static mode): a vertical line + dots at the held sample.
  if (!live && cursorIdx.value != null && cursorIdx.value < n) {
    const i = cursorIdx.value;
    const cx = xFor(ts[i]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.px, g.py, g.pw, g.ph);
    ctx.clip();
    ctx.strokeStyle = themeColor('--chart-scrub', COLORS.scrub);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, g.py); ctx.lineTo(cx, g.py + g.ph); ctx.stroke();
    ctx.setLineDash([]);
    const dot = (v, color, y) => {
      if (!Number.isFinite(v)) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, y ?? yFor(v), 3.5, 0, Math.PI * 2); ctx.fill();
    };
    if (props.expert) {
      const [tlo, thi] = tempRange();
      const tv = props.series.temperature?.[i];
      if (shown.pressure) dot(props.series.pressure[i], X_COLORS.pressure);
      if (shown.flow) dot(props.series.flow[i], X_COLORS.flow);
      if (shown.weight) dot(props.series.weightFlow[i], X_COLORS.weight);
      if (shown.temperature && Number.isFinite(tv) && tv > 0) {
        dot(tv, X_COLORS.temperature, g.py + g.ph - ((tv - tlo) / (thi - tlo)) * g.ph);
      }
    } else {
      dot(props.series.pressure[i], COLORS.pressure);
      if ((props.series.flow[i] ?? 0) > 0.02) dot(props.series.flow[i], COLORS.flowGoal);
      if ((props.series.weightFlow[i] ?? 0) > 0.02) dot(props.series.weightFlow[i], COLORS.weight);
    }
    ctx.restore();
  }
}

// ── Line helpers, shared by both modes ──────────────────────────────────────
/** Straight-segment polyline. The GOAL curves use this on purpose: a profile's
 *  target is a genuine step function (it jumps at frame boundaries), and a
 *  spline through a step overshoots on both sides — smoothing it would draw a
 *  ramp where the real target is a hard edge. */
function line(vals, style, dash, windowStart, xFor, yFor, width = 2) {
  if (!vals) return;
  const ts = props.series.elapsed, n = ts.length;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    if (t < windowStart) continue;
    if (!started) { ctx.moveTo(xFor(t), yFor(vals[i])); started = true; }
    else ctx.lineTo(xFor(t), yFor(vals[i]));
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Catmull-Rom spline (its standard cubic-bezier conversion) for the ACTUAL
 *  series: samples arrive at ~4Hz, so a polyline visibly kinks at every point.
 *  The spline still passes through every real sample (nothing averaged away or
 *  delayed), it just rounds the corners between them. */
function smoothLine(vals, style, windowStart, xFor, yFor, opts = {}) {
  if (!vals) return;
  const ts = props.series.elapsed, n = ts.length;
  const skipZero = opts.skipZero === true;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    if (t < windowStart) continue;
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    if (skipZero && v <= 0) continue; // temperature is 0 on a sample that carried none
    pts.push([xFor(t), yFor(v)]);
  }
  if (!pts.length) return;
  ctx.strokeStyle = style;
  ctx.lineWidth = opts.width ?? 2;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.stroke();
}

// ── Normal mode: flow bars with the pressure curve over them ────────────────
function drawNormal(g, gridColor, windowStart, w, h) {
  const { live, now, span, pps, xFor, yFor } = g;
  const ts = props.series.elapsed, n = ts.length;

  // Grid: horizontal every 3 units; vertical ticks every 5s. Live: ticks
  // scroll WITH the data, making the constant motion readable even before
  // bars exist. Static: ticks sit at fixed 0, 5, 10... positions.
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let v = 3; v < MAX_Y; v += 3) {
    ctx.beginPath(); ctx.moveTo(0, yFor(v)); ctx.lineTo(w, yFor(v)); ctx.stroke();
  }
  const tickStart = live ? Math.max(0, Math.ceil((now - span) / 5) * 5) : 0;
  for (let t = tickStart; t <= now; t += 5) {
    const x = xFor(t);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }

  // ── Flow bins: average samples per BIN_S bucket (recomputed per frame — a
  // 35s live window holds ~140 samples at 4Hz and a full shot only somewhat
  // more, so this is trivially cheap and avoids incremental-state
  // bookkeeping). Live's newest, still-filling bin is drawn too: that's the
  // bar visibly "growing in" at the right edge.
  const bins = new Map(); // bin index -> accumulated sums
  for (let i = n - 1; i >= 0; i--) {
    const t = ts[i];
    if (t < windowStart) break; // elapsed is monotonic — nothing older matters
    const k = Math.floor(t / BIN_S);
    let b = bins.get(k);
    if (!b) { b = { f: 0, g: 0, wt: 0, c: 0 }; bins.set(k, b); }
    b.f += props.series.flow[i];
    b.g += props.series.targetFlow[i];
    b.wt += props.series.weightFlow[i];
    b.c++;
  }
  const bw = Math.max(1, pps * BIN_S - 2); // 2px gap between bars
  for (const [k, b] of bins) {
    const x0 = xFor(k * BIN_S + BIN_S / 2) - bw / 2;
    const flow = b.f / b.c, goal = b.g / b.c, wflow = b.wt / b.c;
    if (flow > 0.02) {
      ctx.fillStyle = COLORS.flow;
      ctx.fillRect(x0, yFor(flow), bw, h - yFor(flow));
    }
    if (wflow > 0.02) {
      ctx.fillStyle = COLORS.weight;
      ctx.fillRect(x0, yFor(wflow), bw, h - yFor(wflow));
    }
    if (props.showTargets && goal > 0.02) {
      ctx.strokeStyle = COLORS.flowGoal;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, yFor(goal) + 0.5, bw - 1, h - yFor(goal) - 1);
    }
  }

  // ── Pressure: dashed goal under the solid actual curve.
  if (props.showTargets) line(props.series.targetPressure, COLORS.pressureGoal, [6, 5], windowStart, xFor, yFor);
  smoothLine(props.series.pressure, COLORS.pressure, windowStart, xFor, yFor);

  // Leading dot on the newest pressure sample — the "pen" of the strip chart.
  // Live only: a static history graph has no "now", so no pen either.
  if (live && n) {
    ctx.fillStyle = COLORS.pressure;
    ctx.beginPath();
    ctx.arc(xFor(ts[n - 1]), yFor(props.series.pressure[n - 1]), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Expert mode: axes with numbers, one line per series ─────────────────────
function drawExpert(g, gridColor, windowStart) {
  const { px, py, pw, ph, live, now, span, xFor, yFor } = g;
  const ts = props.series.elapsed, n = ts.length;
  const axisText = themeColor('--muted', 'rgba(233,237,242,0.55)');
  const [tlo, thi] = tempRange();
  // Clamped: on a fixed live scale a reading can fall outside the band (a
  // cold start, a preheat spike), and it belongs on the edge of the plot, not
  // drawn over the axis labels. A fitted scale always contains its data, so
  // the clamp never bites there.
  const yTemp = (v) => py + ph - ((Math.min(Math.max(v, tlo), thi) - tlo) / (thi - tlo)) * ph;

  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.lineWidth = 1;

  // Left scale: the shared 0-12 pressure/flow axis, one gridline per label.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= MAX_Y; v += 2) {
    const y = yFor(v);
    ctx.strokeStyle = gridColor;
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke();
    ctx.fillStyle = axisText;
    ctx.fillText(String(v), px - 6, y);
  }

  // Right scale: temperature, labelled in its own colour so the axis says
  // which curve it belongs to without needing a second legend entry.
  ctx.textAlign = 'left';
  const tStep = (thi - tlo) / 4;
  for (let i = 0; i <= 4; i++) {
    const v = tlo + tStep * i;
    ctx.fillStyle = X_COLORS.temperature;
    // Plotted in Celsius, labelled in whatever the user reads.
    ctx.fillText(`${dispTemp(v)}°`, px + pw + 6, yTemp(v));
  }

  // Time along the bottom. Live: the labels scroll WITH the data (the window
  // moves over the shot), so they stay true elapsed times rather than counting
  // the viewport.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = timeStep(span);
  const first = live ? Math.max(0, Math.ceil((now - span) / step) * step) : 0;
  for (let tv = first; tv <= now + 0.001; tv += step) {
    const x = xFor(tv);
    if (x < px - 1 || x > px + pw + 1) continue;
    ctx.strokeStyle = gridColor;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py + ph); ctx.stroke();
    ctx.fillStyle = axisText;
    ctx.fillText(`${Math.round(tv)}s`, x, py + ph + 5);
  }

  // The curves, clipped to the plot so nothing bleeds into the gutters as the
  // live window scrolls. Drawn back to front: goals under actuals, and
  // pressure last since it's the one curve you read first.
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  if (shown.goals) {
    if (shown.pressure) line(props.series.targetPressure, X_COLORS.pressureGoal, [6, 5], windowStart, xFor, yFor, 1.5);
    if (shown.flow) line(props.series.targetFlow, X_COLORS.flowGoal, [6, 5], windowStart, xFor, yFor, 1.5);
    if (shown.temperature && props.series.targetTemperature) {
      line(props.series.targetTemperature, X_COLORS.temperatureGoal, [6, 5], windowStart, xFor, yTemp, 1.5);
    }
  }
  if (shown.temperature) smoothLine(props.series.temperature, X_COLORS.temperature, windowStart, xFor, yTemp, { skipZero: true });
  if (shown.weight) smoothLine(props.series.weightFlow, X_COLORS.weight, windowStart, xFor, yFor);
  if (shown.flow) smoothLine(props.series.flow, X_COLORS.flow, windowStart, xFor, yFor);
  if (shown.pressure) smoothLine(props.series.pressure, X_COLORS.pressure, windowStart, xFor, yFor);

  // The "pen": the newest sample of every visible series. Live only — a static
  // history graph has no "now".
  if (live && n) {
    const pen = (vals, color, y) => {
      const v = vals?.[n - 1];
      if (!Number.isFinite(v)) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(xFor(ts[n - 1]), y(v), 3, 0, Math.PI * 2); ctx.fill();
    };
    if (shown.pressure) pen(props.series.pressure, X_COLORS.pressure, yFor);
    if (shown.flow) pen(props.series.flow, X_COLORS.flow, yFor);
    if (shown.weight) pen(props.series.weightFlow, X_COLORS.weight, yFor);
    if (shown.temperature && (props.series.temperature?.[n - 1] ?? 0) > 0) {
      pen(props.series.temperature, X_COLORS.temperature, yTemp);
    }
  }
  ctx.restore();

  // Axis rules last, so the curves sit inside a drawn frame rather than over
  // the top of it.
  ctx.strokeStyle = gridColor;
  ctx.beginPath();
  ctx.moveTo(px, py); ctx.lineTo(px, py + ph); ctx.lineTo(px + pw, py + ph);
  ctx.stroke();
}

// Map a clientX to the nearest sample index and emit its values (static only).
function scrubAt(clientX) {
  if (props.mode === 'scroll') return;
  const el = wrap.value;
  const ts = props.series.elapsed, n = ts.length;
  if (!el || !n) return;
  const rect = el.getBoundingClientRect();
  const g = geometry(el.clientWidth, el.clientHeight);
  const x = Math.min(Math.max(clientX - rect.left, g.px), g.px + g.pw);
  const t = g.now - (g.px + g.pw - x) / g.pps;
  let best = 0, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(ts[i] - t);
    if (d < bd) { bd = d; best = i; }
  }
  cursorIdx.value = best;
  emit('scrub', {
    elapsed: ts[best],
    pressure: props.series.pressure[best] ?? 0,
    flow: props.series.flow[best] ?? 0,
    weightFlow: props.series.weightFlow[best] ?? 0,
  });
}
function onPointerDown(e) {
  if (props.mode === 'scroll') return;
  e.currentTarget.setPointerCapture?.(e.pointerId);
  scrubAt(e.clientX);
}
function onPointerMove(e) {
  if (cursorIdx.value == null) return;
  scrubAt(e.clientX);
}
function endScrub() {
  if (cursorIdx.value == null) return;
  cursorIdx.value = null;
  emit('scrub', null);
}

onMounted(() => {
  ctx = cv.value.getContext('2d');
  raf = requestAnimationFrame(draw);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <!-- Expert mode adds its own legend ABOVE the plot, because there the legend
       is a control (tap a series to drop it) rather than a caption — the
       caller's own .glabel caption is hidden in that mode. It doubles as the
       scrub readout that caption gave, so holding a finger on a history plot
       still reads out values. -->
  <div class="strip-wrap">
    <div v-if="expert" class="strip-legend">
      <button
        v-for="s in LEGEND"
        :key="s.key"
        class="sl-chip"
        :class="{ off: !shown[s.key] }"
        :aria-pressed="shown[s.key]"
        @click="shown[s.key] = !shown[s.key]"
      >
        <span class="sw" :style="{ background: s.color }"></span>{{ t(s.label) }}
        <b v-if="scrubbed && shown[s.key]">{{ s.key === 'temperature' ? fmtLegend(dispTemp(scrubbed[s.key]), 0) : fmtLegend(scrubbed[s.key], 1) }}<small>{{ s.key === 'temperature' ? tempUnitLabel : s.unit }}</small></b>
      </button>
      <button class="sl-chip sl-goals" :class="{ off: !shown.goals }" :aria-pressed="shown.goals" @click="shown.goals = !shown.goals">
        {{ t('liveShot.goals') }}
      </button>
    </div>
    <div
      ref="wrap"
      class="shot-graph-canvas"
      :class="{ scrubbable: mode === 'static' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endScrub"
      @pointercancel="endScrub"
      @pointerleave="endScrub"
    >
      <canvas ref="cv" class="strip-canvas"></canvas>
    </div>
  </div>
</template>
