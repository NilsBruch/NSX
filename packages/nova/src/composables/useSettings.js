/**
 * Reactive mirrors + thin wrappers for the Settings tiles. Unlike useCore.js,
 * none of this is preloaded at boot — each panel loads its own slice of data
 * lazily when opened, since Settings is not on the hot path.
 */
import { reactive, ref } from 'vue';
import { setWakelockOverride, setBrightnessOverride } from './useScreensaver.js';

const { NSXCore, NSXApi } = window;

export const devices = ref([]);
// The gateway reports connection as `state: "connected"`, not a boolean — map
// it to a `connected` flag so the UI has a single, stable field to read.
const mapDevices = (list) => (list || []).map((d) => ({ ...d, connected: d.state === 'connected' || d.connected === true }));

// Live device updates. The gateway pushes the full device list over
// /ws/v1/devices (bridged to the 'devices' event) whenever anything changes —
// including as a scan discovers devices. This subscription is what makes a
// scan's results actually appear: connected devices arrive in `devices[]`,
// freshly-discovered-but-unconnected ones in connectionStatus.found*. Merge
// both, deduped by id with the connected entry winning (it carries the real
// state), so a found device shows up as a tappable "disconnected" row.
NSXCore.on('devices', (payload) => {
  const connected = Array.isArray(payload?.devices) ? payload.devices : [];
  const found = [
    ...(payload?.connectionStatus?.foundMachines || []),
    ...(payload?.connectionStatus?.foundScales || []),
  ];
  const byId = new Map();
  for (const d of found) byId.set(d.id, d);
  for (const d of connected) byId.set(d.id, d);
  devices.value = mapDevices([...byId.values()]);
});

export async function loadDevices() {
  await NSXCore.loadDevices();
  devices.value = mapDevices(NSXCore.getDevices());
}
export async function scanForDevices() {
  await NSXCore.scanForDevices();
  // The live 'devices' push above updates the list as devices are found; this
  // delayed re-read is a fallback in case no push arrives (BLE scans take a
  // few seconds, so give it time before re-reading the REST list).
  setTimeout(() => { loadDevices().catch(() => {}); }, 3000);
}
export async function connectToDevice(id) {
  await NSXCore.connectToDevice(id);
  devices.value = mapDevices(NSXCore.getDevices());
}
export async function disconnectDevice(id) {
  await NSXCore.disconnectDevice(id);
  devices.value = mapDevices(NSXCore.getDevices());
}

export const plugins = ref([]);
const VISUALIZER_ID = 'visualizer.reaplugin';

/**
 * The gateway's own (capitalised) field names for the Visualizer plugin,
 * mapped to Nova's local camelCase. Confirmed against NSX — which runs on real
 * machines — and Beanie's plugin schema, which agree exactly.
 *
 * Nova previously used the lowercase names as the wire names too, so every
 * read came back undefined (the panel showed "Not set" even with Visualizer
 * configured) and every save wrote a key the plugin ignores. The mock gateway
 * used the lowercase names as well, which is exactly why this never surfaced
 * in development — its fixtures now match the real API instead.
 *
 * The plugin's schema has no "extended metadata" field; Nova's old
 * extendedMetadata toggle wrote to nothing, so it is gone. Defaults below are
 * the schema's own (AutoUpload true, LengthThreshold 5s).
 */
const VIZ_KEYS = {
  username: 'Username',
  password: 'Password',
  autoUpload: 'AutoUpload',
  minShotDuration: 'LengthThreshold',
  backSync: 'BackSync',
  backSyncIntervalSeconds: 'BackSyncIntervalSeconds',
};

export const visualizerSettings = reactive({
  username: '', autoUpload: true, minShotDuration: 5,
  backSync: false, backSyncIntervalSeconds: 300,
});

/**
 * Whether a password is STORED — which is no longer the same as knowing it.
 * From Decaid 0.7.17-beta.4 the gateway redacts secure fields and reports only
 * that they are set, so the panel can show "saved" but can never pre-fill.
 * Reads every shape we might be talking to: a plain string (older gateways), a
 * redacted `{ isSet: true }`, or a `secretsSet` envelope — so one build works
 * across gateway versions.
 */
export const visualizerPasswordSet = ref(false);
function readPasswordSet(raw) {
  const v = raw?.[VIZ_KEYS.password];
  if (typeof v === 'string') return v !== '';
  if (v && typeof v === 'object') return v.isSet === true;
  return raw?.secretsSet?.[VIZ_KEYS.password] === true;
}

export async function loadPlugins() {
  await NSXCore.loadPlugins();
  plugins.value = NSXCore.getPlugins();
}
export async function setPluginEnabled(id, enabled) {
  await NSXCore.setPluginEnabled(id, enabled);
  plugins.value = NSXCore.getPlugins();
}
export async function loadVisualizerSettings() {
  const s = (await NSXCore.loadPluginSettings(VISUALIZER_ID)) || {};
  // Copy only real primitives, key by key: a blanket Object.assign of the raw
  // map would both miss the capitalised names and, on a redacting gateway,
  // drop `{ isSet: true }` straight into a settings field.
  for (const [local, remote] of Object.entries(VIZ_KEYS)) {
    if (local === 'password') continue; // never held locally — see visualizerPasswordSet
    const v = s[remote];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      visualizerSettings[local] = v;
    }
  }
  visualizerPasswordSet.value = readPasswordSet(s);
}

export async function saveVisualizerSetting(key, value) {
  if (key !== 'password') visualizerSettings[key] = value;
  await NSXCore.savePluginSetting(VISUALIZER_ID, VIZ_KEYS[key], value);
  if (key === 'password') visualizerPasswordSet.value = value !== '';
}
export const visualizerPlugin = () => plugins.value.find((p) => p.id === VISUALIZER_ID);

export const appSettings = reactive({});
export const machineSettings = reactive({});
export const advancedSettings = reactive({});
export async function loadAppSettings() {
  Object.assign(appSettings, await NSXCore.loadAppSettings());
}
export async function loadMachineSettings() {
  Object.assign(machineSettings, await NSXCore.loadMachineSettings());
}
export async function loadAdvancedSettings() {
  Object.assign(advancedSettings, await NSXCore.loadAdvancedSettings());
}
export async function saveAppSetting(key, value) {
  appSettings[key] = value;
  await NSXCore.saveAppSetting(key, value);
}
export async function saveMachineSetting(key, value) {
  machineSettings[key] = value;
  await NSXCore.saveMachineSetting(key, value);
}
export async function saveAdvancedSetting(key, value) {
  advancedSettings[key] = value;
  await NSXCore.saveAdvancedSetting(key, value);
}

/** The refill-alert threshold isn't a skin setting at all — pushRefillLevel
 * is a real gateway command, and the CURRENT value is just machine.water.
 * refillLevel (already tracked live via the waterLevel core event), not a
 * separate thing to fetch or store here. */
export async function pushRefillLevel(mm) {
  await NSXApi.pushRefillLevel(mm);
}

/** The machine on/off weekly schedule — the same domain NSX's Schedule UI
 * already drives (see schedule.js); Nova just mirrors its snapshot into Vue. */
export const scheduleState = reactive(NSXCore.getScheduleState());
NSXCore.on('scheduleChanged', (snapshot) => Object.assign(scheduleState, snapshot));
export function applySchedule(patch) {
  NSXCore.applySchedule(patch);
}

export const machineInfo = ref(null);
export async function loadMachineInfo() {
  machineInfo.value = await NSXApi.fetchMachineInfo();
}

/**
 * The GATEWAY's own build and whether a newer one exists — the two reads the
 * settings page's App card is made of. Same shape as machineInfo above, with
 * one difference: both routes are absent on older gateway builds, so a failure
 * leaves the ref null and the card renders what it knows instead of throwing
 * out of the caller's onMounted (which would take the whole page down with it).
 */
export const gatewayInfo = ref(null);
export async function loadGatewayInfo() {
  gatewayInfo.value = await NSXApi.fetchGatewayInfo().catch(() => null);
}
export const appUpdate = ref(null);
export async function loadAppUpdate() {
  appUpdate.value = await NSXApi.fetchAppUpdate().catch(() => null);
}

/* ── Updates: the app, and this skin ──────────────────────────────────────────
 * Three moving parts, one card (UpdateWidget.vue):
 *
 *  - appRelease / skinRelease: "is something newer published?", answered by
 *    comparing against GitHub release tags in core's update domain. The gateway
 *    cannot answer this on desktop — its own checker reports phase "idle" with a
 *    null latestVersion there — so a badge driven off /api/v1/update stays blank
 *    on the machines people actually use.
 *  - appUpdate (AppUpdateState, live on ws/v1/update): the gateway's own view,
 *    which is what carries `installable` and the download progress. Only used
 *    for ACTING, not for the badge.
 *  - runSkinUpdate: the gateway re-downloads this skin from its recorded source.
 *    That one works everywhere, and is the only update this skin can finish by
 *    itself.
 */

/** This build, and the release stream it is published in (vite defines). */
const SKIN_ID = typeof __SKIN_ID__ === 'string' ? __SKIN_ID__ : 'Nova-skin';
export const SKIN_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
// NSX and Nova release out of ONE repo with two tag streams ('v*' / 'nova-v*'),
// so the newest release of the repo is regularly not the newest Nova.
const SKIN_TAG_PREFIX = 'nova-v';

export const appRelease = ref(null);   // { current, latest, known, updateAvailable, releasesUrl }
export const skinRelease = ref(null);  // { installed, latest, known, updateAvailable, releasesUrl }

/**
 * Ask GitHub what the newest published app and skin are. `force` is a person
 * pressing the button: it drops the cached tags so the question is really asked
 * again (a re-render is served from the cache).
 */
export async function loadReleaseChecks(force = false) {
  if (force) NSXCore.clearReleaseCache();
  const [app, skin] = await Promise.all([
    NSXCore.checkAppUpdate().catch(() => null),
    NSXCore.checkSkinUpdate(SKIN_ID, { tagPrefix: SKIN_TAG_PREFIX, force }).catch(() => null),
  ]);
  appRelease.value = app;
  skinRelease.value = skin;
}

/**
 * Open the gateway's update channel and ask it, silently, where it stands.
 * Silent on purpose: on desktop the answer is "idle" with nothing in it, which
 * is not worth a toast — the badge comes from loadReleaseChecks either way.
 * What this is really here for is `installable` and the download progress.
 */
export function startAppUpdateChannel() {
  NSXApi.connectAppUpdate(
    (data) => {
      // A rejected command replies directly, with no phase — surface that one.
      if (data && data.error && !data.phase) {
        NSXCore.emit('toast', data.url ? `${data.error} — ${data.url}` : data.error);
        return;
      }
      appUpdate.value = data;
    },
    () => { try { NSXApi.sendAppUpdateCommand({ command: 'check' }); } catch { /* not connected yet */ } },
  );
}

export function stopAppUpdateChannel() {
  NSXApi.disconnectAppUpdate();
}

/**
 * Ask the gateway to re-check. Silent when the channel isn't there: on a gateway
 * too old for ws/v1/update this would toast on every press, while the part of
 * the check the user actually sees — the release comparison — worked fine.
 */
export function sendAppUpdateCheck() {
  try {
    NSXApi.sendAppUpdateCommand({ command: 'check' });
  } catch { /* no channel; loadReleaseChecks still answers the question */ }
}

/**
 * Start the in-app app update. Only offered when the gateway says `installable`
 * — which today means Android; every other platform installs from the release
 * page, so the card links there instead.
 */
export function installAppUpdate() {
  try {
    NSXApi.sendAppUpdateCommand({ command: 'install' });
  } catch (err) {
    NSXCore.emit('toast', err?.message || String(err));
  }
}

/**
 * Have the gateway download the newest skin files, then reload into them.
 *
 * The reload is the point: the new files are on disk but this tab is still
 * running the old bundle. Only reloads when the on-disk version actually
 * changed, so pressing this with nothing new leaves the screen alone.
 * @returns {Promise<{updated: boolean, version: string}>}
 */
export async function runSkinUpdate() {
  const result = await NSXCore.installSkinUpdate(SKIN_ID);
  if (result.updated) {
    skinRelease.value = { ...(skinRelease.value || {}), installed: result.version, updateAvailable: false };
    setTimeout(() => window.location.reload(), 1500);
  }
  return result;
}

/** Auto Sleep — NSX's presence settings, not an app/machine settings key. */
export const presenceSettings = reactive({ userPresenceEnabled: false, sleepTimeoutMinutes: 30 });
export async function loadPresenceSettings() {
  Object.assign(presenceSettings, await NSXApi.fetchPresenceSettings());
}
export async function savePresenceSetting(key, value) {
  presenceSettings[key] = value;
  await NSXApi.updatePresenceSettings({ ...presenceSettings });
}

/**
 * Skin-local (Nova store namespace) preferences — no gateway/DE1 involved
 * except wakelock, which is a display-service call, not a machine one.
 *
 * The store isn't loaded yet at module-import time (NSXCore.loadStore() runs
 * inside bootCore(), which main.js awaits AFTER these defaults are read), so
 * these initial values are placeholders — loadSkinSettings() must be called
 * once boot finishes to pick up what's actually in the store.
 */
export const skinSettings = reactive({
  wakeOnUnlock: true,
  timeFormat: '24h',
  startTab: 'espresso',
  screensaverBrightness: 30,
  wakelock: true,
  // false = slide the thumb across to unlock; true = a tap anywhere on the
  // lock face wakes it. Off by default: the slider exists so a cloth wiping
  // the screen can't dismiss the lockscreen.
  tapToUnlock: false,
  waterUnit: 'ml', // 'ml' | 'pct' | 'mm' — how the island shows the tank level
  // true  = each tab paints the whole skin in its own accent and tints the
  //         surfaces with it (useAccent.js);
  // false = the original single blue everywhere, untinted greys. The rail's
  //         six tab colours are unaffected either way — those were never the
  //         part in question.
  tabColors: true,
  // Which token block app.css applies, written to <html data-theme> by
  // useAccent.js: 'dark' (the one this skin was designed in), 'light', or
  // 'midnight' (a second dark palette, navy-tinted with raised cards — ported
  // from the Streamline Dark variant NSX ships). All three are the same rules
  // with a different set of token values.
  theme: 'dark',
  shotReviewAutoCloseSec: 5, // 0 = stay open until dismissed
  // true = the profile's pressure/flow TARGETS are drawn alongside the actual
  // ones (dashed curve + outlined bars, see ShotStripChart). OFF by default:
  // what the machine actually did is the reading that matters, and the target
  // encodings double the ink in the plot for a question you only sometimes ask.
  showTargets: false,
  // 'normal' = the strip chart this skin was designed around (flow as bars,
  // pressure as a curve, no axes); 'expert' = the reading instrument: every
  // series a line in NSX's chart colours, axes with numbers (temperature on
  // its own right-hand scale) and a legend that toggles series and goals.
  // Same renderer either way — see ShotStripChart.vue.
  graphMode: 'normal',
  // true = the coffee page becomes a browser: recipe cards on the left, the
  // selected recipe's shot graph on the right, a shot stepper + Edit Recipe
  // button at the bottom, instead of the single-recipe dial layout. OFF by
  // default so the classic page is what everyone keeps seeing.
  coffeeGraph: false,
});
const SKIN_KEYS = {
  wakeOnUnlock: 'nova_wake_on_unlock',
  timeFormat: 'nova_time_format',
  startTab: 'nova_start_tab',
  screensaverBrightness: 'nova_screensaver_brightness',
  wakelock: 'nova_wakelock',
  tapToUnlock: 'nova_tap_to_unlock',
  waterUnit: 'nova_water_unit',
  tabColors: 'nova_tab_colors',
  theme: 'nova_theme',
  shotReviewAutoCloseSec: 'nova_shot_review_autoclose',
  showTargets: 'nova_show_targets',
  graphMode: 'nova_graph_mode',
  coffeeGraph: 'nova_coffee_graph',
};
export function loadSkinSettings() {
  const s = NSXCore.getStore();
  skinSettings.wakeOnUnlock = s.nova_wake_on_unlock !== false;
  skinSettings.timeFormat = s.nova_time_format || '24h';
  skinSettings.startTab = s.nova_start_tab || 'espresso';
  // Default 30; an explicit stored 0 (fully dark lockscreen) must survive, so
  // don't `|| 30` — same trap as shotReviewAutoCloseSec below. 0 is reachable
  // here because SkinPanel edits this through the number pad, which
  // deliberately does not clamp (see ProfileEditor's note on that path).
  skinSettings.screensaverBrightness = s.nova_screensaver_brightness != null ? Number(s.nova_screensaver_brightness) : 30;
  skinSettings.wakelock = s.nova_wakelock !== false;
  skinSettings.tapToUnlock = s.nova_tap_to_unlock === true; // default off
  skinSettings.waterUnit = s.nova_water_unit || 'ml';
  skinSettings.tabColors = s.nova_tab_colors !== false; // default on
  // Migrates the old boolean: a device that only ever stored nova_light_mode
  // keeps the theme it was on, and its next theme change writes nova_theme.
  skinSettings.theme = s.nova_theme || (s.nova_light_mode === true ? 'light' : 'dark');
  // Default 5s; an explicit stored 0 (off) must survive, so don't `|| 5`.
  skinSettings.shotReviewAutoCloseSec = s.nova_shot_review_autoclose != null ? Number(s.nova_shot_review_autoclose) : 5;
  skinSettings.showTargets = s.nova_show_targets === true; // default off
  skinSettings.graphMode = s.nova_graph_mode || 'normal';
  skinSettings.coffeeGraph = s.nova_coffee_graph === true; // default off
}
export async function saveSkinSetting(key, value) {
  skinSettings[key] = value;
  NSXCore.patchStore({ [SKIN_KEYS[key]]: value });
  // Routed through useScreensaver.js's setWakelockOverride, not called
  // directly — that serializes it against lock()/unlock()/the boot sync's own
  // wakelock calls, so this toggle can't race one of those and leave the
  // gateway's override in the wrong state (see that function's doc comment).
  if (key === 'wakelock') await setWakelockOverride(value);
}

/**
 * What the gateway's HOST can actually do to the screen (core's display
 * domain). On a platform that supports neither, the brightness slider and the
 * wake-lock switch are controls that provably do nothing, so the panels hide
 * them. Defaults to supported until the fetch answers, so a slow or old
 * gateway never makes the controls flicker away.
 */
export const displaySupport = reactive({ ...NSXCore.getDisplaySupport() });
export async function loadDisplaySupport() {
  Object.assign(displaySupport, await NSXCore.loadDisplaySupport());
}

/** The DE1's own screen brightness (gateway-side, not skin CSS) — write-only
 * API, so the last value set THIS session is all we can show; it does not
 * reflect a value changed from the machine's own screen.
 *
 * Initialized from the store at MODULE-IMPORT time, same as every other ref
 * in this file — but the store isn't loaded yet then (NSXCore.loadStore()
 * only resolves inside bootCore(), which runs after this module's top-level
 * code), so this starting value is a placeholder. loadDisplayBrightness()
 * re-syncs it once the store is actually ready — called from SettingsView.vue
 * on mount, matching every other lazily-loaded settings group in this file
 * (see the file header). Without it, the slider could silently show the
 * fallback 80 after a reload instead of whatever was really saved. */
export const displayBrightness = ref(Number(NSXCore.getStore().nsx_display_brightness) || 80);
export function loadDisplayBrightness() {
  displayBrightness.value = Number(NSXCore.getStore().nsx_display_brightness) || 80;
}
let _brightnessApplyTimer = null;
export function setBrightness(level) {
  displayBrightness.value = level;
  NSXCore.patchStore({ nsx_display_brightness: level });
  // Debounced so dragging the landing-page slider doesn't fire a REST call per
  // pixel of movement — matches NSX's own 120ms debounce for the same slider.
  // Routed through useScreensaver.js's setBrightnessOverride (not called
  // directly) so a drag landing right as the screen locks/unlocks can't race
  // that call and leave the display at the wrong brightness.
  clearTimeout(_brightnessApplyTimer);
  _brightnessApplyTimer = setTimeout(() => setBrightnessOverride(level), 120);
}
