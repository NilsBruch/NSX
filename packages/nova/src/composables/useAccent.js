/**
 * The document's colour: which theme is in force, and the active tab's accent
 * mixed through it.
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
import { skinSettings } from './useSettings.js';

// How much accent each surface takes. The greys themselves are never copied
// here — they are read from the stylesheet on each pass, so they follow both
// an edit in app.css and a theme switch with nothing to keep in sync.
// The page carries the most (it is the largest area and the one the eye reads
// as "the screen's colour"); the rail island the least, since it sits behind
// six differently-coloured tabs.
const TINT = {
  '--app-bg': 0.04,
  '--page-bg': 0.06,
  '--card-bg': 0.05,
  '--tab-bg': 0.03,
};

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

/**
 * The six tab accents are tuned against a near-black page, where they read at
 * 4.7-6.0:1. On the light theme's ground the SAME colours fall to 2.1-2.7:1 —
 * unusable for the small uppercase labels, badges and star ratings the accent
 * carries. Darkened 35% they land back at 4.5-5.5:1, in the family they had.
 *
 * Done here rather than as a second palette in router/index.js because there is
 * still only one decision per tab: the hue. A hand-picked light variant per tab
 * would be six more values to keep in step with six existing ones, and they
 * would drift.
 */
const LIGHT_DARKEN = 0.35;

/** Call once, from App.vue, with the current route. */
export function useAccent(route) {
  const tabAccent = computed(
    () => TABS.find((t) => t.name === route.name)?.accent ?? DEFAULT_ACCENT
  );

  // Watched as a set: both settings arrive AFTER this first runs
  // (loadSkinSettings only fires once bootCore resolves), so the switches have
  // to re-apply rather than being read once at startup.
  watch(
    [tabAccent, () => skinSettings.tabColors, () => skinSettings.lightMode],
    ([accent, colourByTab, light]) => {
      const root = document.documentElement;
      root.dataset.theme = light ? 'light' : 'dark';

      // Clear the tints BEFORE reading, always. Two reasons, and the second is
      // the one that bites: an inline value would otherwise be what we read
      // back, so each pass would tint an already-tinted colour; and after a
      // theme switch the greys underneath are different ones entirely, so a
      // cached copy from the other theme would be mixed into this one. Reading
      // through getComputedStyle right after removing them is also what keeps
      // app.css the single source of those greys.
      for (const key of Object.keys(TINT)) root.style.removeProperty(key);

      if (!colourByTab) {
        root.style.setProperty('--accent', light ? mix(DEFAULT_ACCENT, '#000000', LIGHT_DARKEN) : DEFAULT_ACCENT);
        return;
      }

      const cs = getComputedStyle(root);
      const shown = light ? mix(accent, '#000000', LIGHT_DARKEN) : accent;
      root.style.setProperty('--accent', shown);
      for (const [key, amount] of Object.entries(TINT)) {
        // A stylesheet that ever drops one of these keys would yield '' here;
        // skip rather than write "#NaNNaNNaN" over a working colour.
        const base = cs.getPropertyValue(key).trim();
        if (base) root.style.setProperty(key, mix(base, shown, amount));
      }
    },
    { immediate: true }
  );
}
