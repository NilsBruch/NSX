// Seed data for the mock gateway. Mutated in-process by the mock's write
// endpoints so a dev session behaves like a real one (create a recipe, hide a
// profile, rate a shot — it all sticks until the server restarts).

export const machineState = { state: "idle", substate: "ready" };

export const machineInfo = {
  name: "Mock DE1",
  version: "1.6.0",
  serial: "MOCK-0001",
};

export const waterLevels = { currentLevel: 780, refillLevel: 100 };

// The GATEWAY's own build (GET /api/v1/info) and whether a newer one exists
// (GET /api/v1/update) — what the settings page's App card reads. Seeded with
// an update pending so the "available" branch is the one you see in dev; the
// "up to date" branch is a phase edit away.
export const gatewayInfo = {
  version: "0.8.3",
  buildNumber: "2506",
  fullVersion: "0.8.3+2506",
  commitShort: "3d6f7c5f",
  buildTime: "2026-08-28T08:30:18Z",
  appStore: false,
};

export const appUpdate = {
  phase: "available",
  currentVersion: "0.8.3",
  latestVersion: "0.8.4",
  releaseNotes: "## What's Changed\n* Mock release notes for the dev gateway.\n* Nothing here was really released.",
};

export const appSettings = {
  chargingMode: "balanced",
  nightModeEnabled: false,
  nightModeSleepTime: 1320,
  nightModeMorningTime: 420,
  gatewayMode: "tracking",
  logLevel: "INFO",
  automaticUpdateCheck: true,
  // NSX's real settings.js writes these three via saveRea (POST /settings),
  // not saveDe1Adv (/machine/settings/advanced) despite being flow-related —
  // matching NSX's actual, hardware-validated call sites, not a guess.
  flowEstimationMultiplier: 1.0,
  weightFlowMultiplier: 1.0,
  volumeFlowMultiplier: 0.3,
  preferredMachineId: null,
  preferredScaleId: null,
  scalePowerMode: "disabled",
};

export const machineSettings = {
  usb: false,
  fan: 0,
  steamPurgeMode: 0,
  flushTemp: 80,
  flushTimeout: 10,
};

export const presenceSettings = {
  userPresenceEnabled: false,
  sleepTimeoutMinutes: 30,
};

export const machineSettingsAdvanced = {
  heaterIdleTemp: 0,
  heaterPh1Flow: 6.0,
  heaterPh2Flow: 6.0,
  heaterPh2Timeout: 0,
};

export const devices = [
  { id: "mock-machine-1", name: "Mock DE1", type: "machine", connected: true },
  { id: "mock-scale-1", name: "Mock Scale", type: "scale", connected: true },
];

export const plugins = [
  {
    id: "settings.reaplugin",
    name: "Settings",
    description: "Core gateway settings",
    loaded: true,
  },
  {
    id: "visualizer.reaplugin",
    name: "Visualizer",
    description: "Upload shots to visualizer.coffee",
    loaded: false,
  },
];

// The Visualizer plugin's REAL field names, which are capitalised — these
// previously used Nova's lowercase local names, so the mock happily served
// whatever Nova asked for and hid the fact that those keys don't exist on a
// real gateway (the panel showed "Not set" on the machine while working here).
// A mock that agrees with the client instead of the API proves nothing.
//
// Values here are what the gateway STORES. Secure ones are redacted on the way
// out — see redactPluginSettings in server.mjs — the way Decaid >=
// 0.7.17-beta.4 does it.
export const pluginSettings = {
  "visualizer.reaplugin": {
    Username: "",
    Password: "",
    AutoUpload: true,
    LengthThreshold: 5,
    BackSync: false,
    BackSyncIntervalSeconds: 300,
  },
};

const step = (temperature, seconds, pressure) => ({
  name: `Step ${temperature}`,
  temperature,
  seconds,
  pressure,
  pump: "pressure",
});

export const profiles = [
  {
    id: "profile:mock-default",
    isDefault: true,
    metadata: { source: "stock" },
    profile: {
      title: "Classic Italian espresso",
      author: "Decent",
      beverage_type: "espresso",
      steps: [step(92, 10, 3), step(92, 20, 9)],
    },
  },
  {
    id: "profile:mock-user",
    metadata: { source: "user" },
    profile: {
      title: "My Blooming Espresso",
      author: "You",
      version: 2,
      beverage_type: "espresso",
      steps: [step(93, 8, 2), step(93, 5, 0), step(92, 22, 8)],
    },
  },
  // Deliberately hidden — exercises the hidden-profile push path (the bug that
  // motivated resolving pushes against the visible+hidden set).
  {
    id: "profile:mock-hidden",
    visibility: "hidden",
    metadata: { source: "user" },
    profile: {
      title: "Hidden Turbo",
      author: "You",
      beverage_type: "espresso",
      steps: [step(90, 6, 6), step(90, 18, 6)],
    },
  },
  {
    id: "profile:mock-cleaning",
    metadata: { source: "user" },
    profile: {
      title: "Cleaning/Forward Flush x5",
      beverage_type: "cleaning",
      steps: [step(90, 5, 8), step(90, 5, 0), step(90, 5, 8), step(90, 5, 0), step(90, 5, 8)],
    },
  },
];

export const deletedProfiles = [];

export const beans = [
  {
    id: "bean-1",
    roaster: "Mock Roasters",
    name: "Yirgacheffe",
    roastDate: "2026-06-20",
    archived: false,
  },
];

export const beanBatches = {
  "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-20", archived: false }],
};

export const grinders = [
  { id: "grinder-1", model: "Niche Zero", settingType: "stepless" },
  { id: "grinder-2", model: "DF64", settingType: "stepless" },
];

// Each measurement nests `machine`/`scale` sub-objects, matching what
// NSXCore.normalizeShotData (packages/core/src/domains/mapping.js) actually
// parses from a real shot record — a flat `{ elapsed, pressure, ... }` shape
// (what this fixture used to have) fails machine.state.substate's
// preinfusion/pouring filter on every sample, silently producing empty series.
const shot = (id, minutesAgo, enjoyment) => {
  const start = new Date(Date.now() - minutesAgo * 60_000);
  const n = 40;
  return {
    id,
    startTime: start.toISOString(),
    timestamp: start.toISOString(),
    // Why the shot ended (see NSXCore.getShotStopReason) — a completed pour.
    stopReason: "targetWeight",
    annotations: { enjoyment, espressoNotes: null, extras: { favorite: false, tags: [] } },
    workflow: {
      profile: { title: "My Blooming Espresso", steps: [] },
      context: {
        coffeeRoaster: "Mock Roasters",
        coffeeName: "Yirgacheffe",
        grinderModel: "Niche Zero",
        grinderSetting: "18",
        targetDoseWeight: 18,
        targetYield: 36,
      },
    },
    measurements: Array.from({ length: n }, (_, i) => ({
      machine: {
        timestamp: new Date(start.getTime() + i * 800).toISOString(),
        state: { substate: i < 2 ? "preinfusion" : "pouring" },
        pressure: i < 6 ? i : 9 - i * 0.05,
        targetPressure: 9,
        flow: i < 6 ? 0.4 : 2.1,
        targetFlow: 2,
        groupTemperature: 92,
        targetGroupTemperature: 93,
        profileFrame: i < 6 ? 0 : 1,
        // the machine's own volume tracking (flow-integrated, present with or
        // without a scale) — ramps roughly alongside weight so the virtual-
        // scale calibration factor (volume/weight) lands near a real ~1 ml/g.
        volume: i < 6 ? 0 : Math.min(37, (i - 6) * 1.12),
      },
      // weight ramps toward the recipe's target yield — real shots report a
      // cumulative scale reading alongside flow, and NSXCore.resolveActualYield
      // reads the last nonzero sample as the shot's actual measured output.
      scale: { weightFlow: i < 6 ? 0.2 : 1.9, weight: i < 6 ? 0 : Math.min(36, (i - 6) * 1.1) },
    })),
  };
};

// enjoyment is 0-100 in the real API (5 stars x 20 points each), NOT 1-5 —
// these fixtures used to carry 3/4/5, which quietly let a skin treating it as
// a 1-5 value look correct locally while crashing on real shots (a rating
// above 5 made Nova's '☆'.repeat(5 - n) throw). Kept on the real scale so that
// mismatch can't hide here again.
export const shots = [shot("shot-1", 20, 80), shot("shot-2", 90, 100), shot("shot-3", 300, 60)];

// Key-value store, namespaced. Matches the real gateway's shape:
// GET /store/<ns>?full=1 returns this dict for <ns>.
export const store = {
  NSX: {
    recipes: [
      {
        id: "recipe-mock-1",
        lastUsed: Date.now() - 60_000,
        coffeeRoaster: "Mock Roasters",
        coffeeName: "Yirgacheffe",
        grinderModel: "Niche Zero",
        grinderSetting: "18",
        profileTitle: "My Blooming Espresso",
        selectedProfileId: "profile:mock-user",
        targetDoseWeight: 18,
        targetYield: 36,
        groupTemp: 93,
      },
      {
        id: "recipe-mock-hidden",
        lastUsed: Date.now() - 3_600_000,
        coffeeRoaster: "Mock Roasters",
        coffeeName: "Turbo Blend",
        grinderModel: "DF64",
        grinderSetting: "3.2",
        profileTitle: "Hidden Turbo",
        selectedProfileId: "profile:mock-hidden",
        targetDoseWeight: 20,
        targetYield: 50,
        groupTemp: 90,
      },
    ],
    "ui-settings": {},
  },
  skin: { theme: "dark", lang: "de" },
};

export const currentWorkflow = {
  profile: profiles[1].profile,
  profileId: profiles[1].id,
  context: store.NSX.recipes[0],
};
