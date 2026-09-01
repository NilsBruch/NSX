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
  shotReviewAutoCloseSec: 5, // 0 = stay open until dismissed
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
  shotReviewAutoCloseSec: 'nova_shot_review_autoclose',
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
  // Default 5s; an explicit stored 0 (off) must survive, so don't `|| 5`.
  skinSettings.shotReviewAutoCloseSec = s.nova_shot_review_autoclose != null ? Number(s.nova_shot_review_autoclose) : 5;
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
