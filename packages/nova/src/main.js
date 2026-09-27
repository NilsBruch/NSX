/**
 * Nova entry point.
 *
 * The shared core is a set of plain browser scripts that assign window.NSXCore /
 * NSXApi / NSXConfig / NSXI18n. We side-effect-import them so Vite bundles them,
 * in exactly the order packages/core/README.md prescribes: each module registers
 * itself on NSXCore, so it must come after anything it uses.
 *
 * `api.js` opens the gateway WebSockets on load — the skin never calls a connect
 * function itself. That is why the core imports come before anything else.
 */
import './core/config.js';
import './core/translations.js';
import './core/api.js';
import './core/core.js';
import './core/store.js';
import './core/push.js';
import './core/domains/schedule.js';
import './core/domains/steam.js';
import './core/domains/hotwater.js';
import './core/domains/flush.js';
import './core/domains/grinder.js';
import './core/domains/equipment.js';
import './core/domains/bean.js';
import './core/domains/shot.js';
import './core/domains/workflow.js';
import './core/domains/profile.js';
import './core/domains/profile-edit.js';
import './core/domains/machine.js';
import './core/domains/mapping.js';
import './core/domains/settings.js';
import './core/domains/devices.js';
import './core/domains/plugins.js';
import './core/domains/profile-simulate.js';
import './core/domains/profile-render.js';
import './core/domains/display.js';
import './core/domains/update.js';
import './core/domains/units.js';

// translations.js (shared with NSX) defaults to German. Nova is English-only
// for now (see the design log) — core functions that read window.NSXI18n?.t
// directly (mapping.js's getBatchAge, buildShotDiffData) would otherwise mix
// German words into Nova's own English UI.
window.NSXI18n?.setLang('en');

// Nova's own gateway store namespace — MUST be claimed before bootCore() runs
// (migrateLegacyStore/loadStore/loadRecipes all read NSXCore.getStoreNamespace()
// at call time). Without this, core defaults to "NSX", and Nova would read and
// write the SAME recipe library, steam/hotwater/flush presets, schedule, and
// display settings as the original skin — one skin's edits silently clobbering
// the other's, and neither actually seeing "their own" data.
window.NSXCore?.setStoreNamespace('Nova');

import { createApp } from 'vue';
import './styles/app.css';
import './styles/phone.css';

import App from './App.vue';
import PageTransition from './components/PageTransition.vue';
import router from './router';
import i18n from './i18n';
import { bootCore } from './composables/useCore.js';
import { adoptCurrentWorkflowAsRecipe } from './composables/useRecipe.js';
import { skinSettings, loadSkinSettings, loadDisplaySupport } from './composables/useSettings.js';
import { wireRevalidateTriggers } from './composables/useRevalidate.js';
import { installErrorReporting } from './composables/useErrorReporting.js';

const app = createApp(App);
// Registered globally: it wraps every full-screen page wherever one is opened
// (some 35 places across views, panels and the phone tabs).
app.component('PageTransition', PageTransition);
installErrorReporting(app);
app.use(router).use(i18n).mount('#app');

// Kick off the core bootstrap. The UI mounts immediately and fills in as the
// store/REST data arrives, so a slow or absent gateway never blocks rendering.
//
// Then adopt whatever workflow the gateway is already holding as a real saved
// recipe, so "what's on the machine is a recipe in your library" is true from
// the start and dial edits always persist somewhere visible. Sequenced here
// rather than inside bootCore() because useCore.js importing useRecipe.js would
// close an import cycle.
// Screen capabilities are a property of the host the gateway runs on, so this
// is fetched once, as early as possible: the settings panels and the two
// display-override helpers all read the cached answer synchronously.
loadDisplaySupport();

// Skin settings as soon as the store is read, not after the whole boot — see
// bootCore's own note. The call below, once everything has loaded, stays: it
// re-applies the same values, and is what the start-tab re-route waits for.
bootCore({ onStoreLoaded: loadSkinSettings }).then(() => {
  // Two devices on the same gateway otherwise never notice each other's
  // writes short of a full reload — see useRevalidate.js.
  wireRevalidateTriggers();

  adoptCurrentWorkflowAsRecipe();
  loadSkinSettings();


  // The router's own '/' -> '/espresso' redirect runs synchronously at mount,
  // before the store (and so nova_start_tab) has loaded — reading it there
  // would always race and lose. Re-route here, once the store is actually
  // ready, but only if the user hasn't already navigated away from the
  // default landing tab in the meantime.
  if (skinSettings.startTab !== 'espresso' && router.currentRoute.value.name === 'espresso') {
    router.replace({ name: skinSettings.startTab });
  }

  // The initial wakelock request/release is owned by useScreensaver.js's own
  // boot-sync handler (see its comment) — it decides based on whether the
  // machine is already asleep, which this unconditional request used to race.
});
