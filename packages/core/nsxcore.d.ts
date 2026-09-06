/**
 * Ambient TypeScript declarations for the NSX shared core globals:
 *   window.NSXCore   — the headless facade (event bus + all domain selectors/commands)
 *   window.NSXApi    — REST + WebSocket gateway client
 *   window.NSXConfig — constants
 *   window.NSXI18n   — i18n
 *
 * Include this in a TypeScript skin (e.g. Vue+Vite) for autocomplete and
 * compile-time checks against the core API. See ./README.md for the runtime
 * contract (bootstrap sequence, event payloads, what stays skin-side).
 *
 * KEEP IN SYNC: when you add/rename/remove a core selector, command, or event,
 * update this file. It is documentation as much as types — accuracy matters.
 *
 * Note on `any`: deep gateway objects (raw shots, profiles, snapshots) are left
 * loose on purpose — their full shape is the gateway's, not ours. The types we
 * own (derived display shapes, normalized shot data, event payloads) are precise.
 */

// ── Loose data shapes (gateway-owned; known fields + open index) ──────────────

/** A shot record as returned by the gateway shots API. */
export interface ShotRecord {
  id?: string;
  timestamp?: string;
  workflow?: any;
  annotations?: { enjoyment?: number; espressoNotes?: string; extras?: any; [k: string]: any };
  metadata?: any;
  measurements?: any[];
  [k: string]: any;
}

/** A profile record: `{ id, profile, metadata, isDefault }`. */
export interface ProfileRecord {
  id: string | null;
  profile: any;
  metadata: { source?: string; [k: string]: any } | null;
  isDefault: boolean;
  visibility?: string;
  [k: string]: any;
}

/** A recipe/workflow display item (from mapApiWorkflowToDisplay / mapShotToWorkflow). */
export interface DisplayWorkflow {
  coffeeRoaster: string;
  coffeeName: string;
  grinderModel: string;
  grinderSetting: string;
  targetDoseWeight: number;
  targetYield: number;
  ratio: string;
  profileTitle: string;
  profileTemp?: string;
  beverageType?: string;
  gatewayWorkflow?: any;
  [k: string]: any;
}

/** Normalized shot series (from normalizeShotData). */
export interface NormalizedShotData {
  elapsed: number[];
  pressure: number[];
  targetPressure: number[];
  flow: number[];
  targetFlow: number[];
  temperature: number[];
  targetTemperature: number[];
  scaleRate: number[];
  substates: string[];
  phaseMarkers: Array<{ time: number; label: string }>;
  [k: string]: any;
}

export interface ShotDiffRow { label: string; value: string; }
export interface RatingResult { max: number | null; count: number; }

export interface Preset { [k: string]: any; }
export interface ScheduleState {
  enabled: boolean;
  days: number[];
  onHour: number; onMinute: number;
  offHour: number; offMinute: number;
  scheduleId: string | null;
}

export interface StoreSettings { [k: string]: any; }

/** GET /api/v1/display -> platformSupported. A `false` means the gateway's host
 *  cannot drive that at all, so the matching control should be hidden. */
export interface DisplaySupport { brightness: boolean; wakeLock: boolean; }

// ── Event map (NSXCore.on) ────────────────────────────────────────────────────

/**
 * Reaprime BLE connection-error taxonomy (devices WS, connectionStatus.error).
 * "Sticky" kinds (adapterOff, bluetoothPermissionDenied, scanFailed) persist
 * across phase transitions until the environment recovers. "Transient" kinds
 * (scaleConnectFailed, machineConnectFailed, scaleDisconnected,
 * machineDisconnected) auto-clear when the phase moves on. The same error can
 * repeat across several `devices` messages while unresolved — dedupe by
 * kind+timestamp before surfacing it to the user.
 */
export interface DeviceError {
  kind: string;
  severity: string;
  timestamp: string;
  deviceId?: string;
  deviceName?: string;
  message: string;
  suggestion?: string;
  details?: Record<string, any>;
}

export interface NSXCoreEventMap {
  // gateway-bridged
  machineConnected: boolean;
  scaleConnected: boolean;
  scaleWeight: { weight: number; weightFlow: number | null };
  machineState: { state: string; substate?: string };
  waterLevel: { currentLevel: number; refillLevel: number };
  devices: {
    devices: any[];
    machineConnected: boolean;
    scaleConnected: boolean;
    connectionStatus: { phase: string; error: DeviceError | null } | null;
  };
  /** Raw machine snapshot (state.state, groupTemperature, pressure, flow, profileFrame, …). */
  liveShot: any;
  timeToReady: { remainingMs: number | null };
  /** Opt-in — only fires after NSXApi.startLogStream(). REA's raw internal log feed. */
  gatewayLog: { timestamp: string | null; level: string | null; message: string };
  // domain-emitted
  steamChanged: void;
  pitcherChanged: void;
  hotwaterChanged: void;
  flushChanged: void;
  scheduleChanged: ScheduleState;
  grindersLoaded: { grinders: any[] };
  beansLoaded: { beans: any[] };
  settingsLoaded: { app: Record<string, any>; machine: Record<string, any>; advanced: Record<string, any> };
  devicesLoaded: { devices: any[] };
  pluginsLoaded: { plugins: any[] };
  displaySupportLoaded: DisplaySupport;
  toast: string;
}

// ── NSXCore facade + all registered domain methods ────────────────────────────

export interface NSXCore {
  // event bus
  on<K extends keyof NSXCoreEventMap>(name: K, cb: (payload: NSXCoreEventMap[K]) => void): () => void;
  on(name: string, cb: (payload: any) => void): () => void;
  off(name: string, cb: (payload: any) => void): void;
  emit<K extends keyof NSXCoreEventMap>(name: K, payload: NSXCoreEventMap[K]): void;
  emit(name: string, payload?: any): void;
  register(impl: Record<string, any>): NSXCore;

  /** The gateway KV-store namespace this skin persists into (settings, recipe
   * library, profile favorites). Defaults to "NSX". */
  getStoreNamespace(): string;
  /** Claim a namespace for this skin — call BEFORE migrateLegacyStore/loadStore/
   * loadRecipes, or those read/write whatever namespace was already claimed
   * (or the "NSX" default), silently sharing data with another skin. */
  setStoreNamespace(ns: string): string;

  // store.js
  getStore(): StoreSettings;
  patchStore(patch: Partial<StoreSettings>): void;
  replaceStore(data: StoreSettings): StoreSettings;
  saveActivePresetName(storageKey: string, name: string): void;
  migrateLegacyStore(): Promise<void>;
  loadStore(): Promise<StoreSettings | null>;

  // push.js
  push(payload: any): void;
  debounced(key: string, fn: () => void, ms?: number): void;

  // machine.js
  getMachineState(): string;
  setMachineState(state: string): void;
  isEspressoLikeState(state: string): boolean;
  canExecuteOperation(operation: string, state?: string): boolean;

  // mapping.js (pure)
  formatMmSs(ms: number): string;
  calcRatio(dose: number, yield_: number): string;
  resolveProfileTemp(profile: any): number | null;
  mapApiWorkflowToDisplay(wf: any): DisplayWorkflow;
  mapShotToWorkflow(shot: ShotRecord): DisplayWorkflow;
  normalizeWorkflowKeyPart(value: unknown): string;
  getWorkflowKey(workflow: Partial<DisplayWorkflow>): string;
  normalizeShotData(shot: ShotRecord | null): NormalizedShotData | null;
  getShotDurationSeconds(fullShot: ShotRecord): number | null;
  buildShotDiffData(currentShot: ShotRecord, latestShot: ShotRecord, currentDurationSec: number | null, latestDurationSec: number | null): ShotDiffRow[];
  buildWorkflowItemsFromShots(shotItems: ShotRecord[], ratingCache?: Map<string, RatingResult>): DisplayWorkflow[];
  computeMaxRating(shotList: ShotRecord[]): RatingResult;
  findShotsForWorkflow(workflow: Partial<DisplayWorkflow>, source: ShotRecord[]): ShotRecord[];
  /** 0-100 `annotations.enjoyment` (the real API scale) -> 0-5 whole stars. */
  enjoymentToStars(enjoyment: number | null | undefined): number;
  /** 0-5 stars -> the 0-100 `annotations.enjoyment` value the API stores. */
  starsToEnjoyment(stars: number | null | undefined): number;
  resolveActualDose(shot: ShotRecord | any): number | null;
  resolveActualYield(fullShot: ShotRecord | any): { value: number | null; unit: "g" | "ml"; estimated: boolean };
  resolveShotVolumeAndWeight(fullShot: ShotRecord | any): { volume: number | null; weight: number | null };
  updateVolumeCalibration(existingCal: { factor: number; samples: number[] } | null | undefined, fullShot: ShotRecord | any): { factor: number; samples: number[] };
  getBatchAge(iso: string | null | undefined): string;

  // settings.js
  getAppSettings(): Record<string, any>;
  getMachineSettings(): Record<string, any>;
  getAdvancedSettings(): Record<string, any>;
  loadAppSettings(): Promise<Record<string, any>>;
  loadMachineSettings(): Promise<Record<string, any>>;
  loadAdvancedSettings(): Promise<Record<string, any>>;
  saveAppSetting(key: string, value: any): Promise<any>;
  saveMachineSetting(key: string, value: any): Promise<any>;
  saveAdvancedSetting(key: string, value: any): Promise<any>;

  // devices.js
  getDevices(): any[];
  loadDevices(): Promise<any[]>;
  scanForDevices(): Promise<any>;
  connectToDevice(deviceId: string): Promise<any>;
  disconnectDevice(deviceId: string): Promise<any>;

  // plugins.js
  getPlugins(): any[];
  getPluginSettings(id: string): Record<string, any>;
  loadPlugins(): Promise<any[]>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  loadPluginSettings(id: string): Promise<Record<string, any>>;
  savePluginSetting(id: string, key: string, value: any): Promise<any>;

  // display.js
  getDisplaySupport(): DisplaySupport;
  loadDisplaySupport(force?: boolean): Promise<DisplaySupport>;

  // profile-render.js (pure)
  renderProfileSpark(profile: any, opts?: {
    theme?: "dark" | "light";
    showXTicks?: boolean;
    showYTicks?: boolean;
    showStageLabels?: boolean;
    legendFontSize?: number;
    centerLegend?: boolean;
    lineStrokeWidth?: number;
    compactMargins?: boolean;
    showLegend?: boolean;
    selectedFrameIdx?: number;
    tickFontSize?: number;
    emptyLabel?: string;
  }): string;

  // workflow.js
  loadRecipes(): Promise<DisplayWorkflow[]>;
  saveRecipes(recipes: DisplayWorkflow[]): Promise<void>;
  makeRecipeId(): string;
  workflowToGatewayPayload(workflow: any): any;
  buildGatewayPayload(workflow: any, opts?: { scaleConnected?: boolean }): Promise<any | null>;

  // shot.js
  getCachedShotDetails(id: string): ShotRecord | null;
  getShotDetails(id: string): Promise<ShotRecord>;
  invalidateShotDetails(id: string): void;
  deleteShot(id: string): Promise<void>;
  updateShot(id: string, patch: any): Promise<any>;
  updateShotWorkflowContext(id: string, ctxPatch: Record<string, any>): Promise<any>;
  updateShotMeta(id: string, patch: any): Promise<any>;

  // profile.js
  getProfiles(): ProfileRecord[] | null;
  getProfilesAll(): ProfileRecord[] | null;
  getDeletedProfiles(): ProfileRecord[] | null;
  invalidateProfiles(): void;
  invalidateProfilesAll(): void;
  invalidateDeletedProfiles(): void;
  normalizeProfileRecord(raw: any): ProfileRecord | null;
  loadProfiles(force?: boolean): Promise<ProfileRecord[]>;
  loadProfilesWithHidden(force?: boolean): Promise<ProfileRecord[]>;
  loadDeletedProfiles(force?: boolean): Promise<ProfileRecord[]>;

  // grinder.js
  getGrinders(): any[];
  setGrindersCache(list: any[]): void;
  loadGrinders(): Promise<void>;
  createGrinder(payload: any): Promise<any>;
  updateGrinder(id: string, payload: any): Promise<any>;
  deleteGrinder(id: string): Promise<any>;

  // bean.js
  getBeans(): any[];
  setBeansCache(list: any[]): void;
  loadBeans(includeArchived?: boolean): Promise<void>;
  createBean(payload: any): Promise<any>;
  updateBean(id: string, payload: any): Promise<any>;
  deleteBean(id: string): Promise<any>;
  /** Day-granular roast date ("2026-06-20T09:31:00Z" -> "2026-06-20"); falsy -> null. */
  normalizeRoastDate(value: string | null | undefined): string | null;
  /** The non-archived batch roasted on this day (null roastDate = the bean's undated bag). Pure. */
  findBatchForRoastDate(batches: any[], roastDate: string | null | undefined): any | null;
  /** Find-or-create the bean with this roaster+name (case-insensitive). */
  resolveBean(roaster: string, name: string): Promise<any>;
  /** Find-or-create the bag of `beanId` roasted on `roastDate`. Identity is
   *  (beanId, roastDate) — the same bag is REUSED across shots, never re-created. */
  resolveBatch(beanId: string, roastDate: string | null | undefined): Promise<any>;

  // schedule.js
  getScheduleState(): ScheduleState;
  applySchedule(patch: Partial<ScheduleState>): void;
  setScheduleId(id: string | null): void;
  hydrateSchedule(): void;
  syncScheduleToApi(): Promise<void>;

  // flush.js
  getFlushFlow(): number;
  getFlushDuration(): number;
  getFlushPresets(): Record<string, Preset>;
  getActiveFlushPreset(): string | null;
  selectFlushPreset(name: string): void;
  setFlushFlow(v: number): void;
  setFlushDuration(v: number): void;
  deactivateFlushPreset(): void;
  setFlushPresets(next: Record<string, Preset>): void;
  hydrateFlush(): void;

  // hotwater.js
  getHotwaterTemp(): number;
  getHotwaterFlow(): number;
  getHotwaterVolume(): number;
  getHotwaterPresets(): Record<string, Preset>;
  getActiveHotwaterPreset(): string | null;
  selectHotwaterPreset(name: string): void;
  setHotwaterTemp(v: number): void;
  setHotwaterFlow(v: number): void;
  setHotwaterVolume(v: number): void;
  deactivateHotwaterPreset(): void;
  setHotwaterPresets(next: Record<string, Preset>): void;
  hydrateHotwater(): void;

  // steam.js
  getSteamTemp(): number;
  getSteamFlow(): number;
  getSteamDuration(): number;
  getSteamPresets(): Record<string, Preset>;
  getActiveSteamPreset(): string | null;
  isSteamEnabled(): boolean;
  getSteamCalibration(): any;
  getPitcherPresets(): any[];
  getActivePitcherIndex(): number;
  getSbwCalibFactor(): number;
  selectSteamPreset(name: string): void;
  deactivateSteamPreset(): void;
  setSteamTemp(v: number): void;
  setSteamFlow(v: number): void;
  setSteamDuration(v: number): void;
  setSteamDurationRaw(v: number): void;
  setSteamEnabled(enabled: boolean): void;
  setSteamPresets(next: Record<string, Preset>): void;
  setSteamCalibration(calib: any): void;
  setPitcherPresets(next: any[]): void;
  setActivePitcher(idx: number): void;
  saveSteamSnapshot(): void;
  applySteamSnapshot(snap: any): void;
  hydrateSteam(): void;
  readonly STEAM_PRESET_DEFAULTS: Record<string, Preset>;
  readonly STEAM_CALIB_DEFAULTS: any;
  readonly PITCHER_PRESET_DEFAULTS: any[];

  // domains attach freely via register(); allow unlisted members
  [key: string]: any;
}

// ── NSXApi (REST + WS client). WebSockets auto-connect on load. ───────────────

export interface NSXApi {
  setMachineState(state: string): Promise<void>;
  fetchCurrentWorkflow(): Promise<any>;
  fetchMachineInfo(): Promise<{ model?: string; version?: string; serialNumber?: string; [k: string]: any }>;
  pushWorkflow(workflow: any): Promise<any>;
  fetchShots(limit?: number | Record<string, any>, offset?: number, search?: string): Promise<{ items: ShotRecord[]; total?: number }>;
  fetchShotDetails(id: string): Promise<ShotRecord>;
  deleteShotById(id: string): Promise<any>;
  updateShotRecord(id: string, patch: any): Promise<any>;
  updateShotMetadata(id: string, patch: any): Promise<any>;
  tareScale(): Promise<void>;
  initiateScaleConnect(): Promise<void>;
  initiateDE1Connect(): Promise<void>;
  disconnectScale(): void;
  /** Opens ws/v1/logs (auto-reconnects while started); subscribe via NSXCore.on("gatewayLog", ...). */
  startLogStream(): void;
  stopLogStream(): void;
  fetchSchedules(): Promise<any>;
  createSchedule(s: any): Promise<any>;
  updateSchedule(id: string, s: any): Promise<any>;
  deleteSchedule(id: string): Promise<any>;
  fetchProfiles(): Promise<any>;
  fetchProfilesIncludingHidden(): Promise<any>;
  fetchProfileById(id: string): Promise<any>;
  saveProfile(id: string | null, profile: any): Promise<any>;
  deleteProfile(id: string): Promise<any>;
  setProfileVisibility(id: string, visibility: string): Promise<any>;
  fetchDeletedProfiles(): Promise<any>;
  purgeProfile(id: string): Promise<any>;
  restoreProfile(id: string): Promise<any>;
  fetchBeans(includeArchived?: boolean): Promise<any>;
  fetchGrinders(): Promise<any>;
  getStoreValue(namespace: string, key: string): Promise<any>;
  setStoreValue(namespace: string, key: string, value: any): Promise<any>;
  setDisplayBrightness(level: number): Promise<any>;
  fetchSettings(): Promise<Record<string, any>>;
  updateReaSettings(payload: Record<string, any>): Promise<any>;
  fetchMachineSettings(): Promise<Record<string, any>>;
  updateMachineSettings(payload: Record<string, any>): Promise<any>;
  fetchMachineSettingsAdvanced(): Promise<Record<string, any>>;
  updateMachineSettingsAdvanced(payload: Record<string, any>): Promise<any>;
  fetchDevices(): Promise<any[]>;
  scanDevices(): Promise<any>;
  connectDevice(deviceId: string): Promise<any>;
  disconnectDevice(deviceId: string): Promise<any>;
  fetchPlugins(): Promise<any[]>;
  setPluginEnabled(id: string, enabled: boolean): Promise<any>;
  fetchPluginSettings(id: string): Promise<Record<string, any>>;
  updatePluginSettings(id: string, payload: Record<string, any>): Promise<any>;
  // …other REST helpers exist; see api.js
  [key: string]: any;
}

export interface NSXConfig { GATEWAY?: string; WS_BASE?: string; [k: string]: any; }
/** DOM-free: dictionary + lookup only. Applying to data-i18n DOM is skin-side. */
export interface NSXI18n { t(key: string): string; setLang(lang: string): void; getLang(): string; }

declare global {
  interface Window {
    NSXCore: NSXCore;
    NSXApi: NSXApi;
    NSXConfig: NSXConfig;
    NSXI18n: NSXI18n;
  }
}

export {};
