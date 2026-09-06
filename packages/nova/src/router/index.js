import { createRouter, createWebHashHistory } from 'vue-router';

import Espresso from '../views/EspressoView.vue';
import Steam from '../views/SteamView.vue';
import HotWater from '../views/HotWaterView.vue';
import Cleaning from '../views/CleaningView.vue';
import Diary from '../views/DiaryView.vue';
import Settings from '../views/SettingsView.vue';

// Icon paths only (no <svg> wrapper) — RegisterRail supplies the viewBox/stroke.
const ICONS = {
  espresso: '<path d="M6 9h13v7a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5V9z"/><path d="M19 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M9 5.5c0-1 1-1 1-2M13 5.5c0-1 1-1 1-2"/>',
  steam: '<path d="M7 20c-1.5-2 1.5-3.5 0-5.5M12 21c-1.5-2 1.5-3.5 0-5.5M17 20c-1.5-2 1.5-3.5 0-5.5"/><path d="M8 11c-2.5-1-3-4.5-.5-5.8C8 3 10.5 2.5 12 4c1.5-1.5 4-1 4.5 1.2C19 6.5 18.5 10 16 11"/>',
  hotwater: '<path d="M12 3.5s5.5 6.3 5.5 10a5.5 5.5 0 0 1-11 0c0-3.7 5.5-10 5.5-10z"/><path d="M9.5 14.5a2.8 2.8 0 0 0 2.3 2.7"/>',
  cleaning: '<path d="M12 4v3M12 7c-3.5 0-5 2-5 4h10c0-2-1.5-4-5-4z"/><path d="M7.5 14.5v.01M10.5 16v.01M13.5 14.5v.01M16.5 16v.01M9 18.5v.01M15 18.5v.01M12 20v.01"/>',
  diary: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15.5H7.5A2.5 2.5 0 0 0 5 21V5.5z"/><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19"/><path d="M9.5 7.5h5.5M9.5 10.5h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.5a7.7 7.7 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.7 7.7 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5z"/>',
};

/**
 * Six top-level pages, each one tap away — the register-tab model.
 * `side` drives which rail the tab sits in: drinks left, management right.
 * Hash history, because the Decent app serves the skin from a static path.
 */
export const TABS = [
  { name: 'espresso', path: '/espresso', component: Espresso, side: 'left',  accent: '#c98a4b', icon: ICONS.espresso },
  { name: 'steam',    path: '/steam',    component: Steam,    side: 'left',  accent: '#7fa8c9', icon: ICONS.steam },
  { name: 'hotwater', path: '/hotwater', component: HotWater, side: 'left',  accent: '#d97b5a', icon: ICONS.hotwater },
  { name: 'cleaning', path: '/cleaning', component: Cleaning, side: 'right', accent: '#5fb8a5', icon: ICONS.cleaning },
  { name: 'diary',    path: '/diary',    component: Diary,    side: 'right', accent: '#a48fd1', icon: ICONS.diary },
  // Petrol. Bluer and more saturated than Cleaning's mint, deeper than Steam's
  // light blue — it sits between the two, and the six tab colours only work as
  // wayfinding while each stays telling on its own. Held at this lightness on
  // purpose: a truer, darker petrol drops to ~3.8:1 against the page, out of
  // family with the other five (4.7-6.0) and short of readable for the small
  // uppercase labels the accent is used for.
  { name: 'settings', path: '/settings', component: Settings, side: 'right', accent: '#4fa3b5', icon: ICONS.settings },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/espresso' },
    ...TABS.map(({ name, path, component }) => ({ name, path, component })),
  ],
});

// Every tab switch is a moment the user is about to look at data (recipes,
// beans, shots) this device may not have re-fetched in a while — see
// useRevalidate.js. A plain window event, not a direct import, so the router
// stays decoupled from Nova's data layer; useRevalidate.js is what listens.
// afterEach rather than beforeEach so the '/' -> '/espresso' redirect above
// has already settled into its real destination before this fires.
router.afterEach(() => {
  window.dispatchEvent(new Event('router:revalidate'));
});

export default router;
