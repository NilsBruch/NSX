<script setup>
/**
 * The centred ring readout: a blurred page, one big number in a circle, and an
 * optional action anchored at the bottom of the screen.
 *
 * This is the middle weight of Nova's three live treatments, and it exists
 * because the other two are wrong for short, hands-free machine actions:
 * LiveShotOverlay's full graph is for espresso (the thing you actually watch),
 * and a page-replacing overlay overstates a ten-second flush or a steam purge.
 * Here the page recedes instead of being replaced, so nothing has to be
 * dismissed when the machine finishes.
 *
 * `progress` is the FILLED fraction (1 = full ring, 0 = empty), which covers
 * both directions the ring is used in: a countdown passes the REMAINING share
 * so the arc drains, a dispense passes the DELIVERED share so it fills. Pass
 * null for an indeterminate action — the ring then stays full and the number
 * is simply counting up, which is honest about there being no known end.
 *
 * `sub` is an optional smaller line under the number, for the readouts whose
 * value only means something against a target ("120" over "/ 200 ml").
 *
 * The optional `left` / `right` slots flank the ring with a second and third
 * reading (steam uses them for boiler temperature and flow). They sit OUTSIDE
 * the circle rather than inside it: the number in the middle is the one the
 * ring is about, and crowding two more into it would cost exactly the
 * glanceability the ring exists for.
 *
 * `raised` lifts the whole thing out of the vertical centre, for when the
 * caller puts something else (the steam graph) in the lower half of the
 * screen.
 */
import { computed, useSlots } from 'vue';

const props = defineProps({
  value: { type: String, required: true },
  progress: { type: Number, default: null },
  sub: { type: String, default: '' },
  raised: { type: Boolean, default: false },
});

const slots = useSlots();
const hasAction = computed(() => !!slots.default);

// r=54 in a 120 box, so C = 2*pi*54. The arc DEPLETES as the value runs out,
// which is the whole point of the ring — the number alone would be just as
// informative but far less glanceable from across the kitchen.
const R = 54;
const C = 2 * Math.PI * R;
const dashOffset = computed(() => {
  if (props.progress == null) return 0;
  return C * (1 - Math.max(0, Math.min(1, props.progress)));
});
</script>

<template>
  <!-- Scrim and ring are siblings, not nested: a parent carrying the blur would
       blur its own child too (backdrop-filter applies to everything painted
       behind the element, and the ring is painted inside it). -->
  <div class="lring-scrim"></div>
  <div class="lring" :class="{ 'lring-raised': raised }">
    <svg class="lring-svg" viewBox="0 0 120 120" aria-hidden="true">
      <circle class="lring-track" cx="60" cy="60" :r="R" />
      <!-- Rotated so the arc starts at 12 o'clock rather than 3. -->
      <circle
        class="lring-arc" cx="60" cy="60" :r="R"
        :stroke-dasharray="C" :stroke-dashoffset="dashOffset"
        transform="rotate(-90 60 60)"
      />
    </svg>
    <div v-if="$slots.left" class="lring-side lring-left"><slot name="left" /></div>
    <div class="lring-val">
      <div class="lring-num">{{ value }}</div>
      <div v-if="sub" class="lring-sub">{{ sub }}</div>
    </div>
    <div v-if="$slots.right" class="lring-side lring-right"><slot name="right" /></div>
  </div>
  <!-- Bottom of the SCREEN, not of the ring: that's where the stop control
       lives in the full-screen live overlays, and a running machine is exactly
       the wrong moment to move it. -->
  <div v-if="hasAction" class="lring-action"><slot /></div>
</template>

<style scoped>
/* -webkit- prefix included for the same reason .rov-scrim documents: the DE1
   tablet's Android 12 WebView is Chromium ~96 and some builds still ship only
   the prefixed name. The rgba() tint is the fallback where neither applies —
   without it an unsupported blur would leave the ring floating on raw,
   unchanged page content. */
.lring-scrim {
  position: fixed; inset: 0; z-index: 13;
  background: var(--scrim-ring);
  -webkit-backdrop-filter: blur(7px);
  backdrop-filter: blur(7px);
  pointer-events: none;
  animation: lring-fade 0.22s ease-out;
}

/* Above the page but below the modals and the screensaver — a machine action
   can start while a picker is open, and the picker is what the user's hands
   are on. */
.lring {
  position: fixed; z-index: 14;
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 200px; height: 200px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--card-bg);
  box-shadow: var(--elev-2);
  pointer-events: none; /* purely a readout — never swallows a tap */
  animation: lring-pop 0.22s ease-out;
}
/* Out of the centre when the caller needs the lower half of the screen. A
   transform rather than a different `top`, so the centring maths above stays
   in one place. */
.lring-raised { transform: translate(-50%, -50%) translateY(-90px); }

/* Flanking readouts: outside the circle, vertically on its centre line, and
   wide enough that a two-digit and a three-digit value don't shift the ring's
   apparent centre. Pointer-events stay off with the rest of the ring. */
.lring-side {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 104px; text-align: center;
}
.lring-left { right: calc(100% + 10px); }
.lring-right { left: calc(100% + 10px); }

.lring-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.lring-track, .lring-arc { fill: none; stroke-width: 6; stroke-linecap: round; }
.lring-track { stroke: var(--ring-track); }
.lring-arc { stroke: var(--accent); transition: stroke-dashoffset 0.12s linear; }
.lring-val { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.lring-num {
  font-size: var(--fs-2xl); font-weight: 700; line-height: 1;
  font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
}
.lring-sub {
  font-size: var(--fs-sm); font-weight: 600; color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/* The scrim above is pointer-events: none, so the action has to opt itself
   back IN — it is the one thing here meant to be tapped. */
.lring-action {
  position: fixed; z-index: 14;
  left: 0; right: 0; bottom: 34px;
  display: flex; justify-content: center; gap: 14px;
  pointer-events: auto;
  animation: lring-fade 0.22s ease-out;
}

/* The blur arriving instantly is what would make a ten-second readout feel
   like an alert. Everything fades in together; the ring also settles the last
   few percent of its scale. */
@keyframes lring-fade {
  from { opacity: 0; }
}
@keyframes lring-pop {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
}
/* The raised ring animates from its own resting place — sharing the keyframe
   above would make it slide down into the centre on entry. */
@keyframes lring-pop-raised {
  from { opacity: 0; transform: translate(-50%, -50%) translateY(-90px) scale(0.92); }
}
.lring-raised { animation-name: lring-pop-raised; }
@media (prefers-reduced-motion: reduce) {
  .lring-scrim, .lring, .lring-action { animation: none; }
}
</style>
