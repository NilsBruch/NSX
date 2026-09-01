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
 * Encodings:
 *  - flow        -> blue bars, averaged over BIN_S bins
 *  - flow goal   -> empty (outlined) bars in the same bins
 *  - weight flow -> brown fill painted over each bar from the bottom;
 *                   in == out ⇒ the bar reads fully brown
 *  - pressure    -> solid curve;  pressure goal -> dashed curve
 * Temperature is deliberately NOT plotted — it lives in the metric tiles; the
 * strip chart is about extraction dynamics on the shared 0-12 scale.
 *
 * Replaces the old ShotGraph.vue (uPlot) for both live and history: a
 * scrolling viewport with painted-over bars isn't a uPlot shape, and
 * hand-rolled canvas is less code than fighting the library's plugin hooks —
 * and using the SAME renderer for both means history looks exactly like the
 * live shot it was recorded from, just uncompressed across the full width.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  // { elapsed, pressure, targetPressure, flow, targetFlow, weightFlow } — parallel arrays.
  series: { type: Object, required: true },
  mode: { type: String, default: 'scroll' }, // 'scroll' | 'static'
  originMs: { type: Number, default: 0 },    // scroll mode: Date.now() at elapsed=0
  windowS: { type: Number, default: 35 },    // scroll mode: seconds visible in the viewport
});
// Touch-and-hold scrubbing (static/history mode only): emits the sample under
// the finger so the legend can read out pressure/flow/weight-flow at that point,
// null when released. Live mode never scrubs (it's still moving).
const emit = defineEmits(['scrub']);
const cursorIdx = ref(null); // index into series.* while scrubbing, else null

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
  const live = props.mode === 'scroll';

  // `now` = the right edge of the viewport in shot-elapsed seconds. Live:
  // real wall-clock elapsed. Static: the shot's own last sample — the whole
  // duration fills the canvas exactly once, no scroll.
  const now = live ? (Date.now() - props.originMs) / 1000 : (n ? ts[n - 1] : 0);
  const span = live ? props.windowS : Math.max(now, 1);
  const pps = w / span;
  const xFor = (t) => w - (now - t) * pps;
  const yFor = (v) => h - (Math.min(Math.max(v, 0), MAX_Y) / MAX_Y) * h;
  const windowStart = live ? now - span - BIN_S : -Infinity;

  // Grid: horizontal every 3 units; vertical ticks every 5s. Live: ticks
  // scroll WITH the data, making the constant motion readable even before
  // bars exist. Static: ticks sit at fixed 0, 5, 10... positions.
  ctx.strokeStyle = themeColor('--chart-grid', COLORS.grid);
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
    if (goal > 0.02) {
      ctx.strokeStyle = COLORS.flowGoal;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, yFor(goal) + 0.5, bw - 1, h - yFor(goal) - 1);
    }
  }

  // ── Pressure: dashed goal under the solid actual curve.
  const line = (vals, style, dash) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = 2;
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
  };
  // Actual pressure only, as a Catmull-Rom spline (its standard cubic-bezier
  // conversion) instead of straight lineTo segments — samples arrive at ~4Hz,
  // so a polyline visibly kinks at every point. The spline still passes
  // through every real sample (nothing averaged away or delayed), it just
  // rounds the corners between them. The GOAL line stays straight-segmented
  // on purpose: the profile's target pressure is a genuine step function
  // (jumps at frame boundaries), and a spline through a step overshoots on
  // both sides — smoothing it would draw a ramp where the real target is a
  // hard edge.
  const smoothLine = (vals, style) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = ts[i];
      if (t < windowStart) continue;
      pts.push([xFor(t), yFor(vals[i])]);
    }
    if (!pts.length) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = 2;
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
  };
  line(props.series.targetPressure, COLORS.pressureGoal, [6, 5]);
  smoothLine(props.series.pressure, COLORS.pressure);

  // Leading dot on the newest pressure sample — the "pen" of the strip chart.
  // Live only: a static history graph has no "now", so no pen either.
  if (live && n) {
    ctx.fillStyle = COLORS.pressure;
    ctx.beginPath();
    ctx.arc(xFor(ts[n - 1]), yFor(props.series.pressure[n - 1]), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Scrub cursor (static mode): a vertical line + dots at the held sample.
  if (!live && cursorIdx.value != null && cursorIdx.value < n) {
    const i = cursorIdx.value;
    const cx = xFor(ts[i]);
    ctx.strokeStyle = themeColor('--chart-scrub', COLORS.scrub);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    ctx.setLineDash([]);
    const dot = (v, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, yFor(v), 3.5, 0, Math.PI * 2); ctx.fill();
    };
    dot(props.series.pressure[i], COLORS.pressure);
    if ((props.series.flow[i] ?? 0) > 0.02) dot(props.series.flow[i], COLORS.flowGoal);
    if ((props.series.weightFlow[i] ?? 0) > 0.02) dot(props.series.weightFlow[i], COLORS.weight);
  }
}

// Map a clientX to the nearest sample index and emit its values (static only).
function scrubAt(clientX) {
  if (props.mode === 'scroll') return;
  const el = wrap.value;
  const ts = props.series.elapsed, n = ts.length;
  if (!el || !n) return;
  const rect = el.getBoundingClientRect();
  const w = el.clientWidth;
  const x = Math.min(Math.max(clientX - rect.left, 0), w);
  const now = ts[n - 1];
  const span = Math.max(now, 1);
  const t = now - (w - x) / (w / span);
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
</template>
