/**
 * The active tab's accent, applied to the whole document.
 *
 * The six-colour palette in router/index.js already existed, but `--accent` was
 * only ever set on the rail's own tab buttons (RegisterRail.vue), scoped to
 * each button's subtree. Everything inside .pages — and every modal, which is
 * a sibling of the stage entirely — therefore fell back to the :root default,
 * so all ~44 var(--accent) usages rendered steam-blue on every screen. That is
 * why a skin WITH a palette looked monochrome.
 *
 * Setting it on documentElement rather than on .stage is deliberate: the shared
 * modals, the phone shell and the live overlays all live outside the stage, and
 * a confirm dialog opened from the Diary should not be blue while the page
 * behind it is violet. The rail's inline per-tab values are more specific than
 * this, so each tab button keeps its OWN colour — which is what makes the rail
 * readable as a set of six destinations rather than six copies of the current
 * page.
 *
 * The surface tint is the second half. A 5% wash of the accent through the
 * greys gives each tab a ground of its own, which is the difference between
 * "coloured icons on grey" and "the screen has a colour". It is computed here
 * in JS rather than with color-mix() for the reason app.css's container-query
 * note gives: the DE1 tablet's WebView is Chromium ~96, and a dropped
 * color-mix() would silently take the whole declaration with it.
 */
import { computed, watch } from 'vue';
import { TABS } from '../router/index.js';

// How much accent each surface takes, and — read from the stylesheet on first
// use — the untinted grey it starts from. Read rather than duplicated: these
// are declared on :root in app.css, and a second copy here would silently rot
// the first time one of them is adjusted there. Captured once, BEFORE anything
// is written to the inline style, so later runs still mix from the original
// greys instead of compounding onto an already-tinted value.
// The page carries the most (it is the largest area and the one the eye reads
// as "the screen's colour"); the rail island the least, since it sits behind
// six differently-coloured tabs.
const TINT = {
  '--app-bg': 0.04,
  '--page-bg': 0.06,
  '--card-bg': 0.05,
  '--tab-bg': 0.03,
};

let BASE = null;
function captureBase() {
  const cs = getComputedStyle(document.documentElement);
  BASE = {};
  for (const key of Object.keys(TINT)) BASE[key] = cs.getPropertyValue(key).trim();
}

const hex = (c) => {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const toHex = (rgb) => `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
/** Linear blend, `amount` of `b` into `a`. */
const mix = (a, b, amount) => {
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  return toHex([ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount]);
};

const DEFAULT_ACCENT = '#7fa8c9';

/** Call once, from App.vue, with the current route. */
export function useAccent(route) {
  const accent = computed(
    () => TABS.find((t) => t.name === route.name)?.accent ?? DEFAULT_ACCENT
  );

  watch(accent, (value) => {
    if (!BASE) captureBase();
    const root = document.documentElement;
    root.style.setProperty('--accent', value);
    for (const [key, amount] of Object.entries(TINT)) {
      // A stylesheet that ever drops one of these keys would yield '' here;
      // skip rather than write "#NaNNaNNaN" over a working colour.
      if (BASE[key]) root.style.setProperty(key, mix(BASE[key], value, amount));
    }
  }, { immediate: true });
}
