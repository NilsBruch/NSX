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
import { computed, unref, watch } from 'vue';
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
 * Themes whose surfaces do NOT take the active tab's hue. The value is the
 * colour to tint with instead, or null for no tint at all.
 *
 * Midnight is the second kind: its whole character is the navy climbing with
 * elevation, and washing any accent through that pulled the greys off it —
 * with a per-tab accent, six different ways; with one fixed accent, uniformly
 * warm, which is not what the palette is. So its greys render exactly as
 * app.css declares them, on every tab.
 *
 * The per-tab --accent itself is untouched either way: icons, labels, chips
 * and the rail still change colour, only the ground stays put.
 */
const FIXED_TINT_THEMES = { midnight: null };

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

/**
 * Call once, from App.vue, with a ref/computed resolving to the active TABLET
 * tab's `name` (router/index.js's TABS). Not a route object: the phone shell
 * never navigates the router at all (see usePhoneNav.js), so App.vue instead
 * passes a computed that maps the active phone tab onto whichever tablet tab
 * shares its colour — the accent decision stays single-sourced in TABS either
 * way, this just widens what can select from it.
 */
export function useAccent(tabNameSource) {
  const tabAccent = computed(
    () => TABS.find((t) => t.name === unref(tabNameSource))?.accent ?? DEFAULT_ACCENT
  );

  // Watched as a set: both settings arrive AFTER this first runs
  // (loadSkinSettings only fires once bootCore resolves), so the switches have
  // to re-apply rather than being read once at startup.
  watch(
    [tabAccent, () => skinSettings.tabColors, () => skinSettings.theme],
    ([accent, colourByTab, theme]) => {
      const root = document.documentElement;
      root.dataset.theme = theme;
      // Only the LIGHT theme needs the accents darkened — 'midnight' is a dark
      // palette like the default one, so the accents read on it unchanged.
      const light = theme === 'light';

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
      // The surfaces take the tab's hue unless the theme fixes them (see
      // FIXED_TINT_THEMES) — a fixed colour to tint with, or null for none, in
      // which case the tints stay cleared and app.css's own greys stand.
      const ground = theme in FIXED_TINT_THEMES ? FIXED_TINT_THEMES[theme] : shown;
      if (!ground) return;
      for (const [key, amount] of Object.entries(TINT)) {
        // A stylesheet that ever drops one of these keys would yield '' here;
        // skip rather than write "#NaNNaNNaN" over a working colour.
        const base = cs.getPropertyValue(key).trim();
        if (base) root.style.setProperty(key, mix(base, ground, amount));
      }
    },
    { immediate: true }
  );
}
