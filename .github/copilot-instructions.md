# NSX — Copilot Instructions

NSX is a vanilla-JS UI skin for the Decent DE1 espresso machine, built on the
Decent.app gateway. It runs as a single-page web app (no build step) served
locally to the machine. The repo is an **npm-workspaces monorepo** (`packages/*`);
npm is only used for monorepo management — the skin itself has no bundler.

## Dev model (read this first)

- **The Decent app serves `packages/nsx/src` as the web root.** That folder must be
  self-contained: `index.html` references core at `core/…`.
- **Source of truth for shared code is `packages/core/src`.** `packages/nsx/src/core/`
  is a **generated copy** (git-ignored). **Edit core only in `packages/core/src`,
  then run `npm run sync-core`.** Never edit `packages/nsx/src/core/` directly.
- No build step: edits take effect on reload. UI language is **German**.
- To run: in Decent, "Settings → Live-edit from folder…" → point at `packages/nsx/src`.

## Layout

```
packages/
  core/src/        # DOM-FREE shared package (SOURCE OF TRUTH)
    config.js, api.js (NSXApi), translations.js (NSXI18n)
    core.js        # window.NSXCore — event bus + register() for commands/selectors
    store.js       # NSXCore store (settings) — extracted Phase 2
    push.js        # NSXCore push/debounced helpers — extracted Phase 2
  nsx/src/         # NSX skin = served web root
    index.html     # loads core/* then modules/* (load ORDER matters)
    modules/app.js # ~11k-line orchestrator (DOM + state + wiring)
    modules/ui.js, router.js, settings.js, screensaver.js
```

`index.html` script order: config → translations → api → core → **store → push** →
router → ui → screensaver → app → settings. A core module that registers on
`NSXCore` must load after `core.js` (and after `api.js`/`translations.js` if it uses
`NSXApi`/`NSXI18n`).

## Ground rules

1. **Ask, don't assume.** Unclear intent → ask before writing code.
2. **Simplest thing that works.** No abstractions/flexibility that weren't requested.
3. **Don't touch unrelated code**, even if it could be improved.
4. **Flag uncertainty explicitly** instead of guessing.
5. **Shot API:** only write `annotations` (not `metadata`/`shotNotes` — deprecated).
   `extras` merges at field level. Post-shot actions go in `_runPostShotActions()`.

## Current work: monorepo / multi-skin refactor (branch `monorepo-multi-skin`)

Goal: extract logic from `app.js` into a shared headless **`NSXCore`** so a second
(Vue) skin can later consume the same core. `main` keeps shipping normal NSX
releases (tag `v*`); refactor lives only on this branch (release tag `nsx-v*`).

**NSXCore API (`core.js`):** `on/off/emit(name, payload)`, `register(impl)` to attach
commands/selectors. A bridge re-emits api.js window events as semantic events
(machineConnected, scaleWeight, machineState, waterLevel, liveShot, …).

### Done
- **Phase 0/1:** monorepo scaffold + `NSXCore` bus/facade skeleton.
- **Phase 2 — settings store** (`core/store.js`): owns the single **stable**
  `storeSettings` object — **mutated in place, never reassigned** — so app.js holds
  `const storeSettings = NSXCore.getStore()` and all ~80 reads stay valid.
  Commands: `patchStore`, `replaceStore`, `saveActivePresetName`, `migrateLegacyStore`,
  `loadStore`, selector `getStore`. app.js keeps thin `patchStoreSettings` /
  `saveActivePresetName` delegators.
- **Phase 2 — push helpers** (`core/push.js`): `NSXCore.push(payload)` (calls
  `NSXApi.pushWorkflow`; on error `emit('toast', msg)`) + `NSXCore.debounced(key, fn, ms)`.
  app.js: `const push = NSXCore.push; const debounced = NSXCore.debounced;
  NSXCore.on('toast', m => showToast(m))`. Domain writers (pushSteamTemp,
  pushFlushFlow, …) stay in app.js and build on these.

### Next: extract domains, in this order
flush → steam/hotwater → schedule → beans/grinders → shots → workflows → live shot
→ machine state. Then a second Vue+Vite skin consuming `NSXCore`.

**Flush domain** (`core/domains/flush.js`): owns `flushPresets`, `activeFlushPreset`,
`flushFlow`, `flushDuration`; commands `selectFlushPreset` / `setFlushFlow` /
`setFlushDuration`; emits a `flushChanged` event. app.js KEEPS all DOM (widget,
preset buttons, settings modal, session overlays, tap-to-edit pickers) and reads
`flushFlow`/`flushDuration` via a selector in `_buildRecipeGatewayPayload` (rinseData)
and the flush session.

### Pattern to follow per extraction (important)
- **One domain per commit.** Mirror the shape of `store.js` / `push.js`: an IIFE that
  grabs `window.NSXCore`, guards that it exists, then `NSXCore.register({...})`.
- Keep **DOM in app.js**; move only state + logic to core. Where app.js still needs a
  value, expose a core **selector** and keep a thin alias/delegator in app.js so call
  sites stay unchanged (minimize diff in the 11k-line file).
- Add the new `<script src="core/<file>.js">` to `index.html` in correct load order.
- After editing core: **`npm run sync-core`**, then `node --check` the changed files.
- **Verify in Decent before committing** (the big file hides reference/load-order bugs).
- End commit messages with the existing convention used on this branch
  (`Phase 2: …`) — see `git log` on `monorepo-multi-skin`.

## Model guidance

Sonnet is sufficient for these domain extractions — the pattern is established
(`store.js`/`push.js` are templates). Work in small steps, **one domain per commit**,
and verify in Decent each time. Switch to Opus only for the gnarlier shared-state
domains later (live shot, workflows) or if you hit a subtle reference/lifecycle bug.
