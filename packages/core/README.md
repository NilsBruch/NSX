# `@nsx/core` — the shared, DOM-free core

`packages/core/src` is the **source of truth** for all logic shared between skins.
It is **headless**: no DOM access, no skin-specific rendering, no reads of a skin's
mutable UI state. A second skin (e.g. a future Vue skin) consumes the exact same
core.

**Editing:** edit only here, then run **`npm run sync-core`** from the repo root
(copies `packages/core/src` → `packages/nsx/src/core/`, a git-ignored generated
copy that the Decent-served web root loads at `core/…`). Never edit
`packages/nsx/src/core/` directly — it is overwritten.

Everything attaches to a single global, **`window.NSXCore`**.

---

## The facade — `core.js`

Loaded first (after `config`/`translations`/`api`). Provides:

- `NSXCore.on(name, cb)` → returns an unsubscribe fn; `NSXCore.off(name, cb)`
- `NSXCore.emit(name, payload)` — publish a semantic event to subscribers
- `NSXCore.register(impl)` — a domain calls this to attach its selectors/commands
  as `NSXCore.<name>(...)`
- `NSXCore.getStoreNamespace()` / `NSXCore.setStoreNamespace(ns)` — the gateway
  KV-store namespace store.js and workflow.js persist into (settings, recipe
  library, profile favorites). Defaults to `"NSX"`. **Every skin besides the
  original must call `setStoreNamespace` before its bootstrap sequence**
  (before `migrateLegacyStore`/`loadStore`/`loadRecipes`) or it silently shares
  the same recipes/settings as whichever skin already owns the default —
  reads and writes both skins make land in one place, each clobbering the
  other's edits with no error.

It also **bridges** api.js's low-level `window` CustomEvents into semantic
`NSXCore` events, so presentation code subscribes to stable names instead of api
internals:

| window event (api.js)   | → NSXCore event    |
|-------------------------|--------------------|
| `gateway:status`        | `machineConnected` (bool) |
| `scale:status`          | `scaleConnected` (bool)   |
| `scale:weight`          | `scaleWeight`      |
| `gateway:machineState`  | `machineState`     |
| `water:level`           | `waterLevel`       |
| `gateway:devices`       | `devices`          |
| `gateway:snapshot`      | `liveShot`         |
| `gateway:timeToReady`   | `timeToReady`      |

## Non-domain modules

- **`config.js`** — constants (`window.NSXConfig`: `GATEWAY`, `WS_BASE`, …).
- **`api.js`** — REST + WebSocket gateway client (`window.NSXApi`). All raw
  `fetch`/WS lives here; domains call `window.NSXApi.<fn>`.
- **`translations.js`** — i18n strings (`window.NSXI18n`, `t(key)`). Domains that
  need a translated string use `window.NSXI18n?.t` with a fallback.
- **`store.js`** — the settings store. Owns the single **stable** `storeSettings`
  object (mutated **in place**, never reassigned), so app.js can hold
  `const storeSettings = NSXCore.getStore()` and ~80 reads stay valid.
  API: `getStore`, `patchStore`, `replaceStore`, `saveActivePresetName`,
  `migrateLegacyStore`, `loadStore`.
- **`push.js`** — `NSXCore.push(payload)` (calls `NSXApi.pushWorkflow`; on error
  `emit('toast', msg)`) and `NSXCore.debounced(key, fn, ms)`.

---

## Domains (`core/src/domains/*.js`)

Each domain is an IIFE that grabs `window.NSXCore`, guards it exists, then
`NSXCore.register({...})`. **Load order matters** — a domain must load after any
core module it depends on (all are listed after `store.js`/`push.js` in
`index.html`). A domain owns state + logic; the **skin keeps the DOM** and calls
these via thin same-named delegates so app.js call sites stay unchanged. Live skin
state a domain needs is **passed in as a parameter**, never read from an app.js
global (keeps core app-state-free).

### Preset / machine-function domains (own values + presets, emit a `*Changed` event)

- **`steam.js`** — `getSteamTemp/Flow/Duration`, `getSteamPresets`,
  `getActiveSteamPreset`, `isSteamEnabled`, `getSteamCalibration`,
  `getPitcherPresets`, `getActivePitcherIndex`, `getSbwCalibFactor`;
  `selectSteamPreset`, `deactivateSteamPreset`, `setSteamTemp/Flow/Duration`,
  `setSteamDurationRaw`, `setSteamEnabled`, `setSteamPresets`,
  `setSteamCalibration`, `setPitcherPresets`, `setActivePitcher`,
  `saveSteamSnapshot`, `applySteamSnapshot`, `hydrateSteam`; defaults
  `STEAM_PRESET_DEFAULTS`, `STEAM_CALIB_DEFAULTS`, `PITCHER_PRESET_DEFAULTS`.
  Emits `steamChanged`, `pitcherChanged`.
- **`hotwater.js`** — `getHotwaterTemp/Flow/Volume`, `getHotwaterPresets`,
  `getActiveHotwaterPreset`; `selectHotwaterPreset`, `setHotwaterTemp/Flow/Volume`,
  `deactivateHotwaterPreset`, `setHotwaterPresets`, `hydrateHotwater`.
  Emits `hotwaterChanged`.
- **`flush.js`** — `getFlushFlow/Duration`, `getFlushPresets`,
  `getActiveFlushPreset`; `selectFlushPreset`, `setFlushFlow/Duration`,
  `deactivateFlushPreset`, `setFlushPresets`, `hydrateFlush`. Emits `flushChanged`.
- **`schedule.js`** — `getScheduleState`; `applySchedule`, `setScheduleId`,
  `hydrateSchedule`, `syncScheduleToApi`. Emits `scheduleChanged`. Persists via
  the store and syncs to the gateway schedule API.

### List / CRUD cache domains (fetch + cache a list, thin CRUD wrappers that throw)

- **`grinder.js`** — `getGrinders`, `setGrindersCache`, `loadGrinders`,
  `createGrinder`, `updateGrinder`, `deleteGrinder`. Emits `grindersLoaded`.
- **`bean.js`** — `getBeans`, `setBeansCache`, `loadBeans(includeArchived?)`,
  `createBean`, `updateBean`, `deleteBean`. Emits `beansLoaded`.
  Also owns **bean/batch resolution**: `normalizeRoastDate(v)` (day-granular, so
  a timestamp and a bare date compare equal), `findBatchForRoastDate(batches, d)`
  (pure), `resolveBean(roaster, name)` and `resolveBatch(beanId, roastDate)` —
  both **find-or-create**.
  A *batch* is one **bag** of a bean, identified by **(beanId, roastDate)** —
  *not* one per shot: every shot from the same bag resolves to the same batch.
  A batch's `roastDate` is treated as **immutable**; a new roast date means a
  different bag, so callers re-resolve to another batch instead of rewriting one
  (rewriting would retroactively change the roast date every past shot on that
  bag reports). The batch is also the only structural link a shot has back to a
  bean (`shot.workflow.context.beanBatchId → batch.beanId → bean`), so a
  workflow without one leaves that link to roaster/name string matching.
  **Deleting a bean cascades on the gateway: its batches go with it.** Past
  shots keep their own record (including the now-dangling `beanBatchId`) — they
  are never deleted — but that link is gone, so they fall back to roaster/name
  matching and, with the bean itself deleted, group under no bean at all. A
  skin offering bean deletion should say so, and should also cut any recipe
  still pointing at that bean: `resolveBean` is find-or-CREATE, so a recipe
  that keeps resolving its roaster/name will silently resurrect the deleted
  bean, stripped of everything but those two fields.
- **`shot.js`** — per-shot-id detail cache (a `Map`, no single canonical list):
  `getCachedShotDetails(id)` (sync, cache-only), `getShotDetails(id)`
  (fetch-or-cache), `invalidateShotDetails`, `deleteShot`, `updateShot`,
  `updateShotMeta`, and `updateShotWorkflowContext(id, ctxPatch)` — patches the
  recipe-as-brewed (grind setting, roaster/bean, targets) by MERGING onto the
  full record, since the gateway's PUT replaces `workflow` wholesale and a
  context-only patch would drop the embedded profile. CRUD wrappers invalidate
  the cache entry on success.
- **`profile.js`** — three independent caches (visible / visible+hidden /
  deleted), each `null` until loaded, never cached empty (gateway can transiently
  return none right after wake): `getProfiles`, `getProfilesAll`,
  `getDeletedProfiles`, `invalidateProfiles`, `invalidateProfilesAll`,
  `invalidateDeletedProfiles`, `normalizeProfileRecord`, `loadProfiles(force?)`,
  `loadProfilesWithHidden(force?)`, `loadDeletedProfiles(force?)`.

### Workflow / recipe

- **`workflow.js`** — recipe-store I/O + the gateway-payload builders:
  `loadRecipes`, `saveRecipes`, `makeRecipeId`, `workflowToGatewayPayload`
  (simple fallback builder), and `buildGatewayPayload(workflow, opts)` — the real
  push-time builder (opts.scaleConnected passed in). Selection state
  (`workflowItems`/`selectedWorkflowIndex`/`selectWorkflow`) intentionally stays
  in app.js (DOM-fused).

### Machine state

- **`machine.js`** — a **passive** value holder for the current machine state (NOT
  an auto-listener — app.js's `machineState` handler reads-then-writes it
  synchronously; see the file header for the load-order race this avoids):
  `getMachineState`, `setMachineState`, `isEspressoLikeState(state)`, and the
  Reaprime op guard `canExecuteOperation(operation, state?)` (+ its
  `ALLOWED_OPERATIONS` table).

### Pure transformations — `mapping.js` (owns **no state at all**)

Every function is a pure transform of its arguments; live app state is passed in
explicitly. This is the shared shot/workflow "domain model": `formatMmSs`,
`calcRatio`, `resolveProfileTemp`, `mapApiWorkflowToDisplay`, `mapShotToWorkflow`,
`normalizeWorkflowKeyPart`, `getWorkflowKey`, `normalizeShotData`,
`getShotDurationSeconds`, `buildShotDiffData`,
`buildWorkflowItemsFromShots(shotItems, ratingCache)`, `computeMaxRating`,
`findShotsForWorkflow(workflow, source)`, `getBatchAge(iso)` (roast-date age,
e.g. "2 weeks" — a recipe's roast date lives on the batch, not the bean stem).
`uniqueFieldValuesByRecency(items, pick)` backs the pickers' suggestion strips:
unique non-empty values of a field, newest first by the item's `createdAt` (the
gateway stamps beans, grinders and profiles with it). `pick` is a dotted path
(`'roaster'`, `'profile.title'`) or a function, and either may return an array
(a bean's `variety`). Items without a parseable `createdAt` rank behind all
dated ones, keeping their relative order.
`resolveActualDose(shot)` / `resolveActualYield(fullShot)` back the shot-review
ratio: dose falls back from an `annotations.actualDoseWeight` the user recorded
to the recipe's planned target (the DE1 never measures dose-in, only output);
yield resolves an `annotations.actualYield` override, then the machine's own
volume snapshot, then the last nonzero scale-weight sample, then a
virtual-scale estimate — in that order, matching NSX's real shot review.
`resolveActualYield` needs a FULL shot (via `getShotDetails`, not the
lightweight list-endpoint shot, which carries neither `measurements` nor
`snapshot`).
`resolveShotVolumeAndWeight(fullShot)` / `updateVolumeCalibration(existingCal, fullShot)`
back the virtual-scale calibration feedback loop: every completed shot (with
a real scale sample AND the machine's own volume tracking) refines a
recipe's ml-per-gram factor (a rolling 4-sample average, rejecting
implausible samples), which a later scale-less shot then uses to estimate
weight from volume — mirrors NSX's real `_runPostShotActions` calibration
step exactly.

### App / machine / device settings

- **`settings.js`** — three independent caches for three independent gateway
  resources (app-level, machine-level, and machine-advanced/calibration
  settings — kept separate rather than merged, since they're fetched/saved
  independently): `getAppSettings`, `getMachineSettings`, `getAdvancedSettings`;
  `loadAppSettings`, `loadMachineSettings`, `loadAdvancedSettings`,
  `saveAppSetting(key, value)`, `saveMachineSetting(key, value)`,
  `saveAdvancedSetting(key, value)` (each an optimistic local merge + gateway
  write). Emits `settingsLoaded`.
- **`devices.js`** — the on-demand REST device list + connect actions a settings
  screen needs (distinct from the always-on `devices` bridged event in
  `core.js`, which is live push status): `getDevices`, `loadDevices`,
  `scanForDevices`, `connectToDevice(deviceId)`, `disconnectDevice(deviceId)`.
  Emits `devicesLoaded`.
- **`plugins.js`** — plugin list + per-plugin settings cache (e.g. the
  Visualizer integration): `getPlugins`, `getPluginSettings(id)`, `loadPlugins`,
  `setPluginEnabled(id, enabled)`, `loadPluginSettings(id)`,
  `savePluginSetting(id, key, value)`. Emits `pluginsLoaded`.
- **`display.js`** — what the gateway's **host platform** can do to the screen,
  from `GET /api/v1/display`'s `platformSupported: { brightness, wakeLock }`:
  `getDisplaySupport()` (sync, cached) and `loadDisplaySupport(force?)`. Emits
  `displaySupportLoaded`. Where a capability is `false`, the matching
  `NSXApi.setDisplayBrightness` / `requestWakeLockOverride` calls are no-ops on
  that host, so a skin should **hide** its brightness slider / "keep screen
  awake" switch rather than offer a control that does nothing. It is a
  capability, not state — fetched once and cached; only an explicit `false`
  hides anything, so an old gateway that omits the field (or one that is
  briefly unreachable) leaves every control visible. The live values in the
  same response are deliberately not cached — read those from
  `NSXApi.fetchDisplayState()`.

No domain of their own — two plain `NSXApi` reads a settings screen needs, with
nothing worth caching:

- **`NSXApi.fetchGatewayInfo()`** — `GET /api/v1/info`: the gateway's own build
  (`version`, `buildNumber`, `fullVersion`, `commitShort`, `buildTime`). Not
  the DE1's — that's `fetchMachineInfo()`.
- **`NSXApi.fetchAppUpdate()`** — `GET /api/v1/update`: `{ phase,
  currentVersion, latestVersion, releaseNotes }`. `phase` is an open set the
  gateway defines (`available` and `upToDate` observed); anything else should
  read as "nothing to report". **Read-only on purpose** — the bridge exposes no
  documented way to start an update, so a skin shows the status and leaves
  installing to the Decent app. Both routes are absent on older gateway builds,
  so call them fail-soft.

### Profile rendering — `profile-render.js` (owns **no state at all**)

- **`renderProfileSpark(profile, opts?)`** — pure SVG string for a profile's
  pressure/flow/temperature curve, ported from NSX's `_profileSparkSvg` so a
  profile picker/manager in any skin gets byte-identical curves instead of
  re-deriving the math. No DOM access: NSX read light/dark theme from
  `document.documentElement.dataset.theme`; here it's an explicit
  `opts.theme` (`"dark"` default). See the file header for the full options list.

---

## Bootstrapping a skin against NSXCore

Load order in the skin's HTML (each core module registers on `NSXCore`, so a module
must load after anything it uses):

```
config.js → translations.js → api.js → core.js → store.js → push.js
  → domains/*.js  → (then your skin's own scripts)
```

**`api.js` opens all gateway WebSockets automatically on load** (scale, water,
machine snapshot, devices, time-to-ready) — a skin does **not** call any connect
function. Live data then flows in as `NSXCore` events (next section).

Recommended startup sequence in the skin (mirrors what NSX does):

1. **Subscribe to the events you need** with `NSXCore.on(...)` — do this early (at
   module load) so nothing is missed; WS messages may already be arriving.
2. `await NSXCore.migrateLegacyStore()` — one-time migration of legacy localStorage
   settings into the store (safe no-op once migrated).
3. `await NSXCore.loadStore()` — load the persisted settings object.
4. `NSXCore.hydrateSteam()`, `hydrateHotwater()`, `hydrateFlush()`,
   `hydrateSchedule()` — seed the machine-function domains from the loaded store.
5. Initial REST load: `NSXApi.fetchMachineInfo()`, `NSXApi.fetchCurrentWorkflow()`,
   `NSXCore.loadProfiles()`, `NSXApi.fetchShots(200)`, `NSXCore.loadRecipes()`,
   `NSXApi.fetchSchedules()` → `NSXCore.setScheduleId(existing.id)`.

Then render from the store/domain selectors and update on events. Writes go through
commands (`NSXCore.setSteamTemp(...)`, `NSXCore.push(...)`, etc.), which persist
and/or push to the gateway and emit `*Changed` events the UI re-renders from.

> **Scale weight is skin-rendered.** The live weight readout is *not* drawn by core
> — a skin renders it from the `scaleWeight` (`{weight, weightFlow}`) and
> `scaleConnected` (`boolean`) events into its own element. (NSX does this in its
> `NSXCore.on("scaleWeight"/"scaleConnected", …)` handlers, updating its
> `#scale-weight` element.) Core no longer touches the DOM at all.

> **Wake-lock override auto-releases when `ws/v1/display` closes.** If a skin
> calls `NSXApi.requestWakeLockOverride()` (REST) or sends `{"command":
> "requestWakeLock"}` over its own `ws/v1/display` connection, the gateway drops
> that override the instant *that specific WebSocket* closes — this prevents an
> orphaned lock from a disconnected skin. **Any skin that opens its own
> `ws/v1/display` connection and tracks wake-lock state locally (to dedupe
> redundant requests) must re-assert the lock after a reconnect** — the gateway
> has already forgotten it, but a naive local cache won't know that. NSX hits
> this in `setupDisplayControl()`/`screensaver.js`: on a display-WS reconnect
> (not the first connect) it calls `invalidateWakeLock()` to clear its dedup
> cache before the next `syncWakeLock()`, so a locked screensaver doesn't
> silently lose its lock after a brief network blip. `api.js` itself doesn't
> hold a persistent `ws/v1/display` socket — this is entirely a skin-side
> concern.

## Event payloads (`NSXCore.on(name, cb)`)

Gateway-bridged events (payloads as emitted by `api.js`):

| Event | Payload |
|-------|---------|
| `machineConnected` | `boolean` |
| `scaleConnected`   | `boolean` |
| `scaleWeight`      | `{ weight: number, weightFlow: number \| null }` |
| `machineState`     | `{ state: string, substate?: string }` |
| `waterLevel`       | `{ currentLevel: number, refillLevel: number }` |
| `devices`          | `{ devices: any[], machineConnected: boolean, scaleConnected: boolean, connectionStatus: { phase: string, error: DeviceError \| null } \| null }` |
| `liveShot`         | the raw machine **snapshot** object — commonly used fields: `state.state`, `state.substate`, `timestamp`, `groupTemperature`, `steamTemperature`, `pressure`, `flow`, `targetPressure`, `targetFlow`, `profileFrame` |
| `timeToReady`      | `{ remainingMs: number \| null }` |
| `gatewayLog`       | `{ timestamp: string \| null, level: string \| null, message: string }` — **opt-in**, see below |

> **`gatewayLog` is opt-in (`ws/v1/logs`).** Unlike every other stream above,
> nothing connects to REA's raw internal log feed (state-machine transitions,
> BLE chatter, etc.) by default — it's diagnostic-only, not something a normal
> UI renders. Call `NSXApi.startLogStream()` to open the socket (auto-reconnects
> with the same backoff as the other streams while started) and subscribe to
> `NSXCore.on("gatewayLog", ...)`; call `NSXApi.stopLogStream()` to close it.

`connectionStatus.error` (Reaprime BLE error taxonomy) — `{ kind, severity, timestamp, deviceId?, deviceName?, message, suggestion, details? }`.
**"Sticky" kinds** (`adapterOff`, `bluetoothPermissionDenied`, `scanFailed`) persist across phase
transitions until the environment recovers (adapter on / permission granted / scan starts
successfully). **Transient kinds** (`scaleConnectFailed`, `machineConnectFailed`,
`scaleDisconnected`, `machineDisconnected`) auto-clear when the phase moves to `scanning`,
`connectingMachine`, `connectingScale`, or `ready`. The same error can repeat across several
`devices` messages while unresolved — dedupe by `kind`+`timestamp` before surfacing it (NSX
does this in its `devices` handler, showing `suggestion` as a toast once per occurrence).

Domain-emitted events (fire after a command mutates that domain):

| Event | Payload |
|-------|---------|
| `steamChanged`, `hotwaterChanged`, `flushChanged` | (none — re-read via the domain's selectors) |
| `pitcherChanged` | (none) |
| `scheduleChanged` | schedule-state snapshot |
| `grindersLoaded` | `{ grinders }` |
| `beansLoaded` | `{ beans }` |
| `settingsLoaded` | `{ app, machine, advanced }` |
| `devicesLoaded` | `{ devices }` |
| `pluginsLoaded` | `{ plugins }` |
| `displaySupportLoaded` | `{ brightness, wakeLock }` |
| `toast` | `string` (message to surface to the user) |

## TypeScript

Ambient declarations for the whole `window.NSXCore` / `NSXApi` / `NSXConfig` /
`NSXI18n` surface live in **[`nsxcore.d.ts`](nsxcore.d.ts)** — include it in a
TS skin (e.g. Vue+Vite) for autocomplete and compile-time checks against the core
API. Keep it in sync when you add/rename a core method.

## What deliberately stays in the skin (`packages/nsx/src/modules/app.js`)

Not everything belongs in core. Left in app.js on purpose because it is DOM-fused
with no clean seam (a second skin reimplements it in its own idiom):

- **`selectWorkflow()`** and workflow **selection state** — mixes DOM render +
  gateway push + persistence in one call.
- **Live shot session** (`liveShot`, the `liveShot` event handler,
  `startLiveShotSession`/`endLiveShotSession`) — real-time data accumulation
  interleaved with immediate chart-DOM updates; the app's most timing-sensitive
  path.
- All **rendering / modals / gestures**: profile picker & editor, bean / grinder /
  batch managers, shot review UI, number & field pickers, swipe gestures.

**Rule of thumb for "can X move to core?":** yes if X is a **pure data
transformation or business rule** (like `mapping.js` or `canExecuteOperation`);
no if X is **DOM-fused** or owns UI-shaped state. Not "is it shot-related" or "is
it big." When unsure, prefer leaving it until a concrete second-skin need appears.
