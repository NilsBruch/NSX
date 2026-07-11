# NSX — Claude Code Guide

## What This Project Is

NSX is a UI skin for the [Decent DE1](https://decentespresso.com/) espresso machine, built on top of the **Decent.app** gateway. It runs as a single-page web app (vanilla JS, no build step at runtime) served locally to the machine's web interface. The repo is an npm-workspaces monorepo (`packages/*`), but npm is only used for monorepo management — the NSX skin itself has no build step.

## Tech Stack

- **Vanilla JS (ES6+)** — no frameworks, no bundler
- **HTML5 + CSS3** — single entry point: `index.html`
- **WebSocket** — real-time updates from the Decent gateway (`packages/core/src/api.js`)
- **uPlot** — charting library for shot graphs (bundled)
- **PWA** — manifest.json enables mobile web app install

## Project Structure

This repo is an **npm-workspaces monorepo** (`packages/*`). The shared, DOM-free
core lives in `packages/core`; each skin is its own package. NSX stays vanilla JS
with no build step.

**The Decent app serves `packages/nsx/src` as the web root**, so that folder must be
fully self-contained: `index.html` references the core at `core/…`, and the core is
synced there from `packages/core/src`. The source of truth is `packages/core/src`;
`packages/nsx/src/core/` is a generated copy (git-ignored). After cloning or editing
any core file, run **`npm run sync-core`**. The release workflow does the same sync
when assembling the ZIP.

```
espresso-skins/                     # repo root (npm workspaces)
├── package.json                    # workspaces + scripts: sync-core, test, dev:mock
├── scripts/sync-core.mjs           # copies packages/core/src -> packages/nsx/src/core
├── tests/
│   └── mock-gateway/               # dependency-light gateway stand-in (npm run dev:mock)
├── packages/
│   ├── core/                       # shared, DOM-FREE package (SOURCE OF TRUTH)
│   │   ├── README.md               # ← full NSXCore API docs (read this for core)
│   │   ├── package.json
│   │   ├── test/                   # node --test unit tests (npm test) + harness.mjs
│   │   └── src/
│   │       ├── config.js           # Constants (window.NSXConfig)
│   │       ├── api.js              # REST + WebSocket gateway client (window.NSXApi)
│   │       ├── translations.js     # i18n strings (window.NSXI18n)
│   │       ├── core.js             # window.NSXCore — event bus + register() + api bridge
│   │       ├── store.js            # settings store (stable storeSettings object)
│   │       ├── push.js             # NSXCore.push / debounced helpers
│   │       └── domains/            # steam, hotwater, flush, schedule, grinder, bean,
│   │                               #   shot, profile, workflow, machine, mapping
│   └── nsx/                         # NSX skin (vanilla JS, no build)
│       ├── package.json
│       └── src/                     # <-- served as the web root in dev & ZIP root
│           ├── index.html          # SPA shell — loads core/ + nsx modules
│           ├── manifest.json       # PWA manifest (id: "NSX-skin")
│           ├── core/               # GENERATED copy of packages/core/src (git-ignored)
│           ├── css/                # app.css, phone.css
│           ├── ui/                 # graphics/, screensaver/ images
│           └── modules/
│               ├── app.js          # Orchestrator — global state, event wiring, post-shot actions
│               ├── ui.js           # DOM rendering
│               ├── settings.js     # Settings panel logic
│               ├── router.js       # Client-side panel navigation
│               ├── screensaver.js  # Screensaver
│               ├── workflow.js     # Workflow stub (not loaded)
│               ├── history.js      # Shot history stub (not loaded)
│               └── liveshot.js     # Live shot data stub (not loaded)
└── .github/workflows/
    └── release-nsx.yml             # Per-skin release (tag: nsx-v*) — assembles a self-contained ZIP
```

> **Edit core only in `packages/core/src`**, then `npm run sync-core` — never edit
> `packages/nsx/src/core/` (it's overwritten).

## Shared logic lives in NSXCore

A lot of what used to live in `app.js` now lives in the DOM-free core as
`window.NSXCore` selectors/commands — see **[`packages/core/README.md`](packages/core/README.md)**
for the full per-domain API. app.js keeps a thin same-named delegate for each so its
call sites are unchanged, e.g. `const mapShotToWorkflow = (s) => NSXCore.mapShotToWorkflow(s)`.

**Already in core** (don't re-implement in app.js): all machine-function presets
(steam / hotwater / flush) + schedule; grinder / bean / shot / profile fetch+cache
+ CRUD; the recipe store and gateway-payload builders; machine state + the
`canExecuteOperation` op-guard; and the pure shot/workflow **mapping** layer
(`normalizeShotData`, `mapShotToWorkflow`, `getWorkflowKey`,
`buildWorkflowItemsFromShots`, `findShotsForWorkflow`, `buildShotDiffData`,
`getShotDurationSeconds`, `computeMaxRating`, formatters).

### Core-first rule (do this for EVERY new function)

To avoid re-implementing something that already exists in core, before writing any
non-trivial function follow these three steps **in order**:

1. **Check core first.** Skim [`packages/core/README.md`](packages/core/README.md)
   and `grep -rin "<concept>" packages/core/src` for an existing equivalent. If it
   exists, **use `NSXCore.<fn>`** (add a thin same-named delegate in the skin if it
   keeps call sites clean) — never reimplement it.
2. **Decide where it belongs.** If it's **pure logic** — a data transformation,
   business rule, formatting, or gateway/API interaction that *any* skin would need
   — it goes in **core** (the fitting domain, or a new `core/src/domains/*.js`), not
   in the skin. Wire a thin delegate in app.js.
3. **Only put it in the skin** if it's **DOM-fused / rendering / UI-shaped state**
   (a second skin would reimplement it in its own idiom anyway).

The dividing line is *pure-vs-DOM-fused*, not "is it shot-related" or "is it big."
When unsure, lean toward core — but don't force DOM-fused code in (see the core
README's "what deliberately stays in the skin"). This rule is what keeps the two
skins sharing one source of truth instead of drifting.

## app.js Function Areas

`app.js` (~11k lines) is the orchestrator: global state, DOM rendering, event wiring,
and everything below. No section headers exist and line numbers drift with every
edit — **grep the function name** to locate it. What remains here is presentation +
skin wiring (the shared logic moved to NSXCore, above):

| Area | Key Functions |
|------|--------------|
| **Dialogs** | `showConfirm`, `showAlert` |
| **Machine state banner** | `updateMachineStateBanner` (guard `canExecuteOperation` → NSXCore) |
| **Workflow / history filters** | `getDisplayWorkflows`, `openFilterModal`, `buildFilterChips`, `_openHistoryFilterModal`, `_handleHistoryChipClick`, `_filterShotsByFavAndRating`, `_filterShotsByChips` |
| **Gateway push** | `pushSelectedWorkflowToMachine`, `_pushCurrentSkinStateToMachine` (payload built by `NSXCore.buildGatewayPayload`) |
| **Workflow selection** | `selectWorkflow`, `plotWorkflowShot` |
| **Espresso fullscreen** | `openEspressoFullscreen`, `updateEspressoFullscreen`, `_updateReserveWidget` |
| **Live shot session** | `startLiveShotSession`, `endLiveShotSession`, `_runPostShotActions`, `pollForNewShot` |
| **Steam / hot water / flush sessions** | `start*Session` / `end*Session` (values via NSXCore preset domains) |
| **App init** | `loadApiData`, `tick`, `signalUserPresence`, `setupPresenceTracking`, `setupDisplayControl` |
| **Machine/scale events** | `NSXCore.on(...)` handlers; `setMachineConnected`/`setScaleConnected` (from ui.js) |
| **Skin settings UI** | `_applyTheme`, `_applySkinBrightness`, `_applyScale`, `_renderScaleControls`, `_renderPresenceSettingsUI` |
| **Settings persistence** | `patchStoreSettings` (→ `NSXCore.patchStore`), `scheduleStorePersist` |
| **Preset UIs** | `loadSteamPresets`, `selectSteamPreset`, `_openSteamSettingsModal`, and hotwater/flush equivalents (DOM only; state in NSXCore) |
| **Schedule UI** | `renderScheduleUI`, `applyScheduleState` (state/sync in NSXCore) |
| **Swipe gestures** | `getSwipeLayer`, `closeAllSwipes`, `getHistorySwipeLayer`, `closeAllHistorySwipes` |
| **History list** | `renderHistory`, `renderHistoryShotsList`, `_loadMoreHistory`, `deleteWorkflowShots`, `_deleteHistoryShot` |
| **Scale-based weighing** | `_applySbwEnabled`, `_applyDoseScale`, `_updateSbwWidget`, `_updateScaleIndicatorVisibility` |
| **Shot review** | `openShotReview`, `closeShotReview`, `_setShotReviewFav`, `_setShotReviewRating`, `_renderReviewTags`, `_navigateReview` |
| **Profile picker / editor** | `openProfilePickerModal`, `_renderProfilePickerList`, `_setProfilePickerMode`, `openProfileEditorModal`, `_peditorSave`, `_peditorBuildProfile`, `_profileSparkSvg` (caches via NSXCore profile domain) |
| **Workflow edit/create** | `openWorkflowEditModal`, `openWorkflowCreateModal`, `_importFromVisualizer` |
| **Number / field / text pickers + keyboard** | `openNumberPicker`, `openFieldPicker`, `openTextEditorModal`, `_setupKeyboard` |
| **Bean manager / batches** | `openBeanManagerModal`, `_beanManagerRenderDetail`, `_beanManagerSaveField`, `openBatchModal`, `formatBatchAge` (bean/grinder/shot data via NSXCore) |
| **Grinder manager** | `renderGrinderTiles`, `loadAndRenderGrinders`, `openMuehlenModal` |
| **Phone layout** | `_updatePhoneMachineCard`, `_selectPhoneTab`, `_applyPhoneLayout` |

---

## Key Conventions

- **Post-shot actions** go in `_runPostShotActions()` in `app.js`
- **Shot API**: only write `annotations`, not `metadata`/`shotNotes` (deprecated). The `extras` field merges at field level.
- **UI language**: German labels, vanilla JS DOM manipulation (no virtual DOM)
- **No build step**: edits to source files take effect immediately on reload
- **Cross-device freshness (ETag)**: list reads go through `getWithEtag` in `api.js`
  (profiles/beans/grinders/shots + `GET /store/<ns>?full=1`). A 304 returns the
  *same payload reference*, so caches detect "unchanged" by identity and skip
  re-render. `setupCrossDeviceRefresh` in `app.js` revalidates the open view on
  tab-resume. Don't add a plain `request()` GET for a list that can change on
  another device.
- **Settings are per-field KV keys** (`nsx_*` in the `NSX` namespace), not one
  blob — `patchStore` writes only the changed key. Never reintroduce a
  whole-object write (it silently clobbers other tabs' fields). Recipes are one
  key but `saveRecipes` does a 3-way merge so concurrent devices don't clobber.

## Testing & running without a DE1

- **`npm test`** — `node --test` unit tests for the DOM-free core
  (`packages/core/test/*.test.mjs`). The core ships as browser IIFEs, so
  `harness.mjs` stubs `window`/`WebSocket` and evaluates them; a test loads
  `core.js` + the domain under test and mocks `window.NSXApi`. Prefer adding a
  test here for any new pure core logic.
- **`npm run dev:mock`** — serves `packages/nsx/src` and a mock gateway (REST +
  WebSocket, faithful ETag semantics) so the skin runs without a machine. See
  `tests/mock-gateway/README.md`. Note: `config.js` hardcodes port 8080; on any
  other port open with `?gateway=http://localhost:<port>`.
- `ws` is the repo's only (dev-only) dependency, used by the mock gateway.

## How the App Starts

1. `index.html` loads all module scripts in order
2. `app.js` initializes last, wires up modules, opens WebSocket to gateway
3. `router.js` handles panel switching; `api.js` drives all live data

---

## Working With Claude on This Project

### Ground Rules

0. **Core-first (check before you implement).** Before writing any non-trivial function, check whether core already has it (`packages/core/README.md` + `grep packages/core/src`); reuse `NSXCore.<fn>` if so. Any pure logic / business rule / API interaction that other skins would need goes in **core**, not the skin. See the "Core-first rule" section above. This is the rule that keeps the skins from duplicating logic.

1. **Ask, don't assume.** If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements.

2. **Simplest solution first.** Always implement the simplest thing that could work. Do not add abstractions or flexibility that weren't explicitly requested.

3. **Don't touch unrelated code.** If a file or function is not directly part of the current task, do not modify it — even if it could be improved.

4. **Flag uncertainty explicitly.** If you are not confident about an approach or technical detail, say so before proceeding. Confidence without certainty causes more damage than admitting a gap.

5. **Suggest better approaches.** Always open to ideas on better ways to do things — don't hesitate to suggest an approach with longer-lasting impact over a tactical change.
