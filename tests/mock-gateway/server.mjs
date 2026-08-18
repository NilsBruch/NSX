/**
 * Mock Streamline-Bridge gateway — local development & tests, no DE1 needed.
 *
 * Serves `packages/nsx/src` as the web root (exactly like the Decent app does)
 * and mocks the REST + WebSocket API on the same port, so the skin runs
 * unmodified against http://localhost:8080.
 *
 * ETag behaviour deliberately mirrors the real gateway, verified against it:
 *   - list endpoints (profiles / beans / grinders / shots) send ETags and
 *     answer If-None-Match with 304
 *   - GET /store/<ns>?full=1 sends an ETag
 *   - GET /store/<ns>/<key> does NOT  ← the quirk behind issue #3
 *
 * Run: npm run dev:mock   (runs sync-core first, then this)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import * as fx from "./fixtures.mjs";

const PORT = Number(process.env.PORT || 8080);

// Which skin to serve: `--skin=nova` (default: nsx). A CLI flag rather than an env
// var so it works the same in cmd/PowerShell/bash.
const SKIN = (process.argv.find((a) => a.startsWith("--skin=")) || "--skin=nsx").split("=")[1];
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// A built skin (Vite: Nova) is served from dist/ — that is the artifact the Decent
// app actually gets, same-origin, so it is the truest local test. A no-build skin
// (NSX) is served straight from src/. Nova's HMR loop instead runs the Vite dev
// server on its own port and calls this gateway cross-origin (see CORS below).
const SKIN_DIR = join(REPO_ROOT, "packages", SKIN);
const WEB_ROOT = [join(SKIN_DIR, "dist"), join(SKIN_DIR, "src")]
  .find((dir) => existsSync(join(dir, "index.html")));

if (!WEB_ROOT) {
  console.error(
    `mock-gateway: no servable skin for --skin=${SKIN}\n` +
    `  looked for index.html in ${join(SKIN_DIR, "dist")} and ${join(SKIN_DIR, "src")}\n` +
    `  (a Vite skin must be built first: npm run build:nova)`
  );
  process.exit(1);
}

/* ── helpers ─────────────────────────────────────────────── */

/** Cheap stable hash (djb2) → quoted ETag per RFC 7232. */
function computeEtag(data) {
  const s = JSON.stringify(data);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `"${(h >>> 0).toString(16)}"`;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/* ── mutable state ───────────────────────────────────────── */

const state = {
  machine: { ...fx.machineState },
  profiles: structuredClone(fx.profiles),
  deletedProfiles: structuredClone(fx.deletedProfiles),
  beans: structuredClone(fx.beans),
  beanBatches: structuredClone(fx.beanBatches),
  grinders: structuredClone(fx.grinders),
  shots: structuredClone(fx.shots),
  store: structuredClone(fx.store),
  workflow: structuredClone(fx.currentWorkflow),
  appSettings: structuredClone(fx.appSettings),
  machineSettings: structuredClone(fx.machineSettings),
  machineSettingsAdvanced: structuredClone(fx.machineSettingsAdvanced),
  presenceSettings: structuredClone(fx.presenceSettings),
  displayBrightness: 80,
  devices: structuredClone(fx.devices),
  plugins: structuredClone(fx.plugins),
  pluginSettings: structuredClone(fx.pluginSettings),
  schedules: [],
  // Simulated shot progression
  shotStartedAt: 0,
  frameOffset: 0,
  heatingStartedAt: 0,
  maintenanceStartedAt: 0,
};

const FLOWING = new Set(["espresso", "steam", "hotWater", "flush"]);
const FRAME_SECONDS = 6;
const SHOT_SECONDS = 15; // sped up for dev; a real espresso shot runs ~25-40s

/**
 * Secure plugin fields are STORED but never returned: from Decaid
 * 0.7.17-beta.4 a GET reports only whether one is set. Mirroring that here is
 * the point — a mock that hands secrets back lets a client quietly depend on
 * reading them, which is exactly how Nova's Visualizer panel shipped believing
 * it could show the saved password.
 */
const SECURE_PLUGIN_FIELDS = { "visualizer.reaplugin": ["Password"] };
function redactPluginSettings(id, settings) {
  const out = { ...settings };
  for (const key of SECURE_PLUGIN_FIELDS[id] ?? []) {
    const v = out[key];
    out[key] = { isSet: typeof v === "string" ? v !== "" : v?.isSet === true };
  }
  return out;
}

/**
 * Persists a shot record for the just-finished brew, built from state.workflow
 * (the currently loaded recipe) — so Nova's "after the shot, show this recipe's
 * history" flow has something real to land on instead of only the seeded mocks.
 * Measurements use the nested { machine: {...}, scale: {...} } shape
 * NSXCore.normalizeShotData actually parses (see fixtures.mjs's shot() builder).
 */
/** One-level-deep merge for PUT/POST /api/v1/workflow — see the route's comment. */
function mergeWorkflow(current, patch) {
  if (!patch || typeof patch !== "object") return current;
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const isPlainObject = (x) => x && typeof x === "object" && !Array.isArray(x);
    merged[key] = isPlainObject(value) && isPlainObject(current?.[key])
      ? { ...current[key], ...value }
      : value;
  }
  return merged;
}

function persistFinishedShot(durationSec) {
  const ctx = state.workflow?.context ?? {};
  const profile = state.workflow?.profile ?? { title: "—", steps: [] };
  const n = 30;
  const start = new Date(Date.now() - durationSec * 1000);
  const rec = {
    id: `shot-${Date.now()}`,
    startTime: start.toISOString(),
    timestamp: start.toISOString(),
    // A completed pour in the sim — drives the post-shot stop-reason toast
    // (NSXCore.getShotStopReason). Real values are an open set; see the API note.
    stopReason: "targetWeight",
    annotations: { enjoyment: null, espressoNotes: null, extras: { favorite: false, tags: [] } },
    workflow: { profile, context: ctx },
    measurements: Array.from({ length: n }, (_, i) => {
      const t = (i / (n - 1)) * durationSec;
      const pouring = t > durationSec * 0.15;
      return {
        machine: {
          timestamp: new Date(start.getTime() + t * 1000).toISOString(),
          state: { substate: pouring ? "pouring" : "preinfusion" },
          pressure: pouring ? 9 : (t / (durationSec * 0.15)) * 9,
          targetPressure: 9,
          flow: pouring ? 2.1 : 0.4,
          targetFlow: 2,
          groupTemperature: 92,
          targetGroupTemperature: 93,
          profileFrame: pouring ? 1 : 0,
        },
        scale: { weightFlow: pouring ? 1.9 : 0.2 },
      };
    }),
  };
  state.shots.unshift(rec);
  return rec;
}

// Simulated heat-up: 12s in dev (real machines take a couple of minutes) so the
// status island's heating ring is exercisable without waiting.
const HEATING_MS = 12_000;

function setMachineState(next) {
  if (next === "skipStep") {
    state.frameOffset += 1; // advance one profile frame
    return;
  }
  // Persist a shot record on ANY transition away from a flowing state while one
  // was actually in progress — the timed auto-finish below, but just as much a
  // client-triggered early stop (Nova's "Skip" button just PUTs machine/state/
  // idle, same as any other state change; there is no separate stop endpoint).
  if (state.shotStartedAt > 0 && FLOWING.has(state.machine.state) && !FLOWING.has(next)) {
    const elapsed = (Date.now() - state.shotStartedAt) / 1000;
    if (elapsed > 0.5) persistFinishedShot(elapsed); // ignore accidental double-calls
  }
  state.machine.state = next;
  if (FLOWING.has(next)) {
    state.machine.substate = "preinfusion";
    state.shotStartedAt = Date.now();
    state.frameOffset = 0;
  } else {
    state.machine.substate = "ready";
    state.shotStartedAt = 0;
    state.frameOffset = 0;
  }
  state.heatingStartedAt = next === "heating" ? Date.now() : 0;
  state.maintenanceStartedAt = MAINTENANCE.has(next) ? Date.now() : 0;
}

/** { remainingMs } while heating, mirroring the real time-to-ready plugin socket;
 *  null once idle/ready — a skin's heating ring should disappear on null, not 0. */
function timeToReady() {
  if (state.machine.state !== "heating" || !state.heatingStartedAt) return { remainingMs: null };
  const remaining = Math.max(0, HEATING_MS - (Date.now() - state.heatingStartedAt));
  if (remaining === 0) setMachineState("idle"); // heat-up finished
  return { remainingMs: remaining };
}

// "cleaning" (backflush) and "descaling" have no live-data stream of their own —
// unlike a shot, there's nothing to sample. They just run for a while then
// return to idle, which is exactly what the guided assistant's on-screen Start
// is waiting to observe (see CleaningAssistant.vue).
const MAINTENANCE = new Set(["cleaning", "descaling"]);
const MAINTENANCE_MS = 8_000;
function maybeFinishMaintenance() {
  if (!MAINTENANCE.has(state.machine.state) || !state.maintenanceStartedAt) return;
  if (Date.now() - state.maintenanceStartedAt >= MAINTENANCE_MS) setMachineState("idle");
}

/** Current simulated snapshot, driving the live graph + step progress. */
function snapshot() {
  const flowing = FLOWING.has(state.machine.state) && state.shotStartedAt > 0;
  const elapsed = flowing ? (Date.now() - state.shotStartedAt) / 1000 : 0;

  if (flowing && elapsed > 2) state.machine.substate = "pouring";
  if (flowing && elapsed > SHOT_SECONDS) setMachineState("idle"); // persists the shot itself

  const frameCount = state.workflow?.profile?.steps?.length || 4;
  const profileFrame = flowing
    ? Math.min(Math.floor(elapsed / FRAME_SECONDS) + state.frameOffset, frameCount - 1)
    : 0;

  return {
    timestamp: new Date().toISOString(),
    state: { state: state.machine.state, substate: state.machine.substate },
    profileFrame,
    pressure: flowing ? Math.min(9, elapsed * 1.6) : 0,
    flow: flowing ? Math.min(2.4, 0.3 + elapsed * 0.08) : 0,
    targetPressure: flowing ? 9 : 0,
    targetFlow: flowing ? 2 : 0,
    groupTemperature: 92 + Math.sin(Date.now() / 4000),
    targetGroupTemperature: 93,
  };
}

/* ── REST routing ────────────────────────────────────────── */

function routeApi(req, res, url, body) {
  const path = url.pathname;
  const method = req.method;
  const q = url.searchParams;

  const json = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(data === null ? "" : JSON.stringify(data));
  };
  const noContent = () => { res.writeHead(204); res.end(); };

  /** Send with ETag + conditional-GET support. */
  const jsonEtag = (data) => {
    const etag = computeEtag(data);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ETag: etag });
    res.end(JSON.stringify(data));
  };

  // ── machine ──
  if (path === "/api/v1/machine/state" && method === "GET") return json(state.machine);
  if (path.startsWith("/api/v1/machine/state/") && method === "PUT") {
    setMachineState(decodeURIComponent(path.split("/").pop()));
    return json(state.machine);
  }
  if (path === "/api/v1/machine/info") return json(fx.machineInfo);
  if (path === "/api/v1/machine/waterLevels") return json(fx.waterLevels);
  if (path === "/api/v1/machine/settings") {
    if (method === "GET") return json(state.machineSettings);
    state.machineSettings = { ...state.machineSettings, ...body };
    return noContent();
  }
  if (path === "/api/v1/machine/settings/advanced") {
    if (method === "GET") return json(state.machineSettingsAdvanced);
    state.machineSettingsAdvanced = { ...state.machineSettingsAdvanced, ...body };
    return noContent();
  }

  // ── app/gateway settings ──
  if (path === "/api/v1/settings") {
    if (method === "GET") return json(state.appSettings);
    state.appSettings = { ...state.appSettings, ...body };
    return noContent();
  }
  if (path === "/api/v1/presence/settings") {
    if (method === "GET") return json(state.presenceSettings);
    state.presenceSettings = { ...state.presenceSettings, ...body };
    return noContent();
  }

  // ── display ──
  if (path === "/api/v1/display" && method === "GET") return json({ brightness: state.displayBrightness });
  if (path === "/api/v1/display/brightness" && method === "PUT") {
    state.displayBrightness = body?.brightness ?? state.displayBrightness;
    return noContent();
  }
  if (path === "/api/v1/display/wakelock" && (method === "POST" || method === "DELETE")) return noContent();

  // ── devices ──
  if (path === "/api/v1/devices" && method === "GET") return json(state.devices);
  if (path === "/api/v1/devices/scan" && method === "GET") return noContent();
  if (path === "/api/v1/devices/connect" && method === "PUT") {
    const id = q.get("deviceId");
    const d = state.devices.find((x) => x.id === id);
    if (d) d.connected = true;
    return d ? json(d) : json({ error: `Device not found: ${id}` }, 404);
  }
  // Disconnect is PUT /devices/disconnect?deviceId=, symmetric with connect —
  // matches the real bridge (the old DELETE /devices/{id} route doesn't exist).
  if (path === "/api/v1/devices/disconnect" && method === "PUT") {
    const id = q.get("deviceId");
    const d = state.devices.find((x) => x.id === id);
    if (d) d.connected = false;
    return d ? json(d) : json({ error: `Device not found: ${id}` }, 404);
  }

  // ── plugins ──
  if (path === "/api/v1/plugins" && method === "GET") return json(state.plugins);
  const pluginToggle = path.match(/^\/api\/v1\/plugins\/([^/]+)\/(enable|disable)$/);
  if (pluginToggle && method === "POST") {
    const id = decodeURIComponent(pluginToggle[1]);
    const p = state.plugins.find((x) => x.id === id);
    if (p) p.loaded = pluginToggle[2] === "enable";
    return noContent();
  }
  const pluginSettingsMatch = path.match(/^\/api\/v1\/plugins\/([^/]+)\/settings$/);
  if (pluginSettingsMatch) {
    const id = decodeURIComponent(pluginSettingsMatch[1]);
    if (method === "GET") return json(redactPluginSettings(id, state.pluginSettings[id] ?? {}));
    state.pluginSettings[id] = { ...(state.pluginSettings[id] ?? {}), ...body };
    return noContent();
  }

  // ── workflow ──
  // NSXApi.fetchCurrentWorkflow() GETs the bare path; pushWorkflow() tries PUT/POST
  // on both this and /workflow/current (gateway-version tolerance) — the mock
  // answers GET on both so either form round-trips the same state.
  if (path === "/api/v1/workflow" && method === "GET") return json(state.workflow);
  if (path === "/api/v1/workflow/current" && method === "GET") return json(state.workflow);
  if (path === "/api/v1/workflow" && (method === "PUT" || method === "POST")) {
    // One-level-deep merge, not a replace: steam.js/hotwater.js/flush.js each push
    // a partial patch of just their own top-level key (e.g. { steamSettings: {
    // targetTemperature } }) whenever a single value changes — a naive replace
    // would wipe out the loaded recipe's profile/context (and any of
    // steamSettings' OTHER fields) every time. buildGatewayPayload's full pushes
    // still replace profile/context wholesale, since those always arrive complete.
    state.workflow = mergeWorkflow(state.workflow, body);
    return json(state.workflow);
  }

  // ── profiles ──
  if (path === "/api/v1/profiles" && method === "GET") {
    if (q.get("visibility") === "deleted") return jsonEtag(state.deletedProfiles);
    const all = q.get("includeHidden") === "true";
    return jsonEtag(all ? state.profiles : state.profiles.filter((p) => p.visibility !== "hidden"));
  }
  if (path === "/api/v1/profiles" && method === "POST") {
    const rec = { id: `profile:${Date.now()}`, metadata: { source: "user" }, ...body };
    state.profiles.push(rec);
    return json(rec, 201);
  }
  if (path.startsWith("/api/v1/profiles/") && method === "GET") {
    const id = decodeURIComponent(path.split("/")[4]);
    const rec = state.profiles.find((p) => p.id === id);
    return rec ? json(rec) : json({ message: "not found" }, 404);
  }
  if (path.startsWith("/api/v1/profiles/") && path.endsWith("/visibility") && method === "PUT") {
    const id = decodeURIComponent(path.split("/")[4]);
    const rec = state.profiles.find((p) => p.id === id);
    if (rec) rec.visibility = body?.visibility ?? null;
    return rec ? json(rec) : json({ message: "not found" }, 404);
  }
  if (path.startsWith("/api/v1/profiles/") && method === "PUT") {
    const id = decodeURIComponent(path.split("/")[4]);
    const i = state.profiles.findIndex((p) => p.id === id);
    if (i < 0) return json({ message: "not found" }, 404);
    state.profiles[i] = { ...state.profiles[i], ...body };
    return json(state.profiles[i]);
  }
  if (path.startsWith("/api/v1/profiles/") && method === "DELETE") {
    const id = decodeURIComponent(path.split("/")[4]);
    const i = state.profiles.findIndex((p) => p.id === id);
    if (i >= 0) state.deletedProfiles.push(...state.profiles.splice(i, 1));
    return noContent();
  }

  // ── beans / batches / grinders ──
  if (path === "/api/v1/beans" && method === "GET") {
    const incl = q.get("includeArchived") === "true";
    return jsonEtag(incl ? state.beans : state.beans.filter((b) => !b.archived));
  }
  if (path === "/api/v1/beans" && method === "POST") {
    const rec = { id: `bean:${Date.now()}`, archived: false, ...body };
    state.beans.push(rec);
    state.beanBatches[rec.id] = [];
    return json(rec, 201);
  }
  if (path.startsWith("/api/v1/beans/") && !path.endsWith("/batches") && (method === "PUT" || method === "DELETE")) {
    const id = decodeURIComponent(path.split("/")[4]);
    const i = state.beans.findIndex((b) => b.id === id);
    if (i < 0) return json({ message: "not found" }, 404);
    if (method === "DELETE") { state.beans.splice(i, 1); return noContent(); }
    state.beans[i] = { ...state.beans[i], ...body };
    return json(state.beans[i]);
  }

  const batchMatch = path.match(/^\/api\/v1\/beans\/([^/]+)\/batches$/);
  if (batchMatch && method === "GET") {
    return jsonEtag(state.beanBatches[decodeURIComponent(batchMatch[1])] ?? []);
  }
  if (batchMatch && method === "POST") {
    const beanId = decodeURIComponent(batchMatch[1]);
    const rec = { id: `batch:${Date.now()}`, beanId, archived: false, ...body };
    state.beanBatches[beanId] = state.beanBatches[beanId] ?? [];
    state.beanBatches[beanId].unshift(rec); // newest first, like the real gateway
    return json(rec, 201);
  }
  const singleBatchMatch = path.match(/^\/api\/v1\/bean-batches\/([^/]+)$/);
  if (singleBatchMatch) {
    const id = decodeURIComponent(singleBatchMatch[1]);
    const list = Object.values(state.beanBatches).flat();
    const rec = list.find((b) => b.id === id);
    if (method === "GET") return rec ? json(rec) : json({ message: "not found" }, 404);
    if (method === "PUT") {
      if (!rec) return json({ message: "not found" }, 404);
      Object.assign(rec, body);
      return json(rec);
    }
    if (method === "DELETE") {
      for (const beanId of Object.keys(state.beanBatches)) {
        state.beanBatches[beanId] = state.beanBatches[beanId].filter((b) => b.id !== id);
      }
      return noContent();
    }
  }

  if (path === "/api/v1/grinders" && method === "GET") return jsonEtag(state.grinders);
  if (path === "/api/v1/grinders" && method === "POST") {
    const rec = { id: `grinder:${Date.now()}`, ...body };
    state.grinders.push(rec);
    return json(rec, 201);
  }
  if (path.startsWith("/api/v1/grinders/") && (method === "PUT" || method === "DELETE")) {
    const id = decodeURIComponent(path.split("/").pop());
    const i = state.grinders.findIndex((g) => g.id === id);
    if (i < 0) return json({ message: "not found" }, 404);
    if (method === "DELETE") { state.grinders.splice(i, 1); return noContent(); }
    state.grinders[i] = { ...state.grinders[i], ...body };
    return json(state.grinders[i]);
  }

  // ── shots ──
  if (path === "/api/v1/shots" && method === "GET") {
    const limit = Number(q.get("limit") ?? 20);
    const offset = Number(q.get("offset") ?? 0);

    // api.js sends these filters (see fetchShots); ignoring them and returning
    // every shot regardless — which this route used to do — is exactly the kind
    // of "the mock silently lies" bug that has bitten more than once. Nova's
    // orphan-bag cleanup asks "are there any shots for this batch?", and a mock
    // that answers "yes, here are all of them" makes that logic untestable.
    const eq = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
    const filters = [
      ["beanBatchId", (s, v) => s.workflow?.context?.beanBatchId === v],
      ["grinderId", (s, v) => s.workflow?.context?.grinderId === v],
      ["coffeeName", (s, v) => eq(s.workflow?.context?.coffeeName, v)],
      ["coffeeRoaster", (s, v) => eq(s.workflow?.context?.coffeeRoaster, v)],
      ["grinderModel", (s, v) => eq(s.workflow?.context?.grinderModel, v)],
      ["profileTitle", (s, v) => eq(s.workflow?.profile?.title, v)],
    ];

    let matched = state.shots;
    for (const [param, predicate] of filters) {
      const value = q.get(param);
      if (value != null && value !== "") matched = matched.filter((s) => predicate(s, value));
    }
    const search = q.get("search");
    if (search) {
      const needle = search.trim().toLowerCase();
      matched = matched.filter((s) => {
        const ctx = s.workflow?.context || {};
        return [ctx.coffeeName, ctx.coffeeRoaster, s.workflow?.profile?.title]
          .some((field) => String(field ?? "").toLowerCase().includes(needle));
      });
    }

    return jsonEtag({ items: matched.slice(offset, offset + limit), total: matched.length });
  }
  if (path.startsWith("/api/v1/shots/") && method === "GET") {
    const id = decodeURIComponent(path.split("/")[4]);
    const s = state.shots.find((x) => x.id === id);
    return s ? json(s) : json({ message: "not found" }, 404);
  }
  if (path.startsWith("/api/v1/shots/") && method === "PUT") {
    const id = decodeURIComponent(path.split("/")[4]);
    const s = state.shots.find((x) => x.id === id);
    if (!s) return json({ message: "not found" }, 404);
    // The real API merges `extras` at field level.
    if (body?.annotations) {
      s.annotations = {
        ...s.annotations,
        ...body.annotations,
        extras: { ...s.annotations?.extras, ...body.annotations?.extras },
      };
    }
    return json(s);
  }
  if (path.startsWith("/api/v1/shots/") && method === "DELETE") {
    const id = decodeURIComponent(path.split("/")[4]);
    const i = state.shots.findIndex((x) => x.id === id);
    if (i >= 0) state.shots.splice(i, 1);
    return noContent();
  }

  // ── key-value store ──
  const nsMatch = path.match(/^\/api\/v1\/store\/([^/]+)$/);
  if (nsMatch && method === "GET") {
    const ns = decodeURIComponent(nsMatch[1]);
    // Only the namespace-wide (?full=1) read is ETag-backed — same as the real
    // gateway. This is exactly why issue #3 switched recipes/favorites to it.
    const data = state.store[ns] ?? {};
    return q.get("full") === "1" ? jsonEtag(data) : json(Object.keys(data));
  }
  const kvMatch = path.match(/^\/api\/v1\/store\/([^/]+)\/([^/]+)$/);
  if (kvMatch) {
    const ns = decodeURIComponent(kvMatch[1]);
    const key = decodeURIComponent(kvMatch[2]);
    if (method === "GET") {
      const val = state.store[ns]?.[key];
      // NOTE: no ETag here, on purpose — mirrors the real gateway.
      return val === undefined ? json({ message: "not found" }, 404) : json(val);
    }
    if (method === "POST" || method === "PUT") {
      state.store[ns] = state.store[ns] ?? {};
      state.store[ns][key] = body;
      return noContent();
    }
    if (method === "DELETE") {
      delete state.store[ns]?.[key];
      return noContent();
    }
  }

  // ── misc ──
  if (path === "/api/v1/scale/tare") return noContent();
  // Real CRUD (not a stub): NSXCore.schedule.js relies on the created id coming
  // back so it can PUT updates to the same resource instead of re-POSTing a new
  // schedule on every change.
  if (path === "/api/v1/presence/schedules" && method === "GET") return json(state.schedules);
  if (path === "/api/v1/presence/schedules" && method === "POST") {
    const rec = { id: `schedule:${Date.now()}`, ...body };
    state.schedules.push(rec);
    return json(rec, 201);
  }
  if (path.startsWith("/api/v1/presence/schedules/") && (method === "PUT" || method === "DELETE")) {
    const id = decodeURIComponent(path.split("/").pop());
    const i = state.schedules.findIndex((s) => s.id === id);
    if (i < 0) return json({ message: "not found" }, 404);
    if (method === "DELETE") { state.schedules.splice(i, 1); return noContent(); }
    state.schedules[i] = { ...state.schedules[i], ...body };
    return json(state.schedules[i]);
  }
  if (path.startsWith("/api/v1/steams/")) return json({ message: "not found" }, 404);

  return json({ message: `mock: unhandled ${method} ${path}` }, 404);
}

/* ── static file serving (packages/nsx/src as web root) ──── */

async function serveStatic(url, res) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = join(WEB_ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(WEB_ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/* ── HTTP server ─────────────────────────────────────────── */

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Permissive CORS — dev only. The real gateway serves the skin from its own
  // origin, but a Vite dev server (Nova, port 5173) is a different origin, and the
  // shared core deliberately calls the gateway on an absolute URL rather than
  // through a proxy. Without these headers the browser would block every REST call.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, If-None-Match");
  res.setHeader("Access-Control-Expose-Headers", "ETag");
  if (req.method === "OPTIONS") { res.writeHead(204); return void res.end(); }

  if (!url.pathname.startsWith("/api/")) return void serveStatic(url, res);

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = null;
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
    }
    try {
      routeApi(req, res, url, body);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: String(err?.message || err) }));
    }
  });
});

/* ── WebSockets ──────────────────────────────────────────── */

const WS_PATHS = [
  "/ws/v1/machine/snapshot",
  "/ws/v1/scale/snapshot",
  "/ws/v1/machine/waterLevels",
  "/ws/v1/devices",
  "/ws/v1/logs",
  "/ws/v1/plugins/time-to-ready.reaplugin/timeToReady",
];

const wss = new Map(WS_PATHS.map((p) => [p, new WebSocketServer({ noServer: true })]));

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  const target = wss.get(pathname);
  if (!target) return void socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

const broadcast = (path, payload) => {
  for (const ws of wss.get(path).clients) {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  }
};

// Announce connected devices + scale status on connect. NO_SCALE=1 omits the
// scale so the skin's no-scale code paths (e.g. hot-water volume readout) can
// be exercised.
const NO_SCALE = process.env.NO_SCALE === "1";
wss.get("/ws/v1/devices").on("connection", (ws) =>
  ws.send(JSON.stringify({
    devices: [
      { type: "machine", state: "connected" },
      ...(NO_SCALE ? [] : [{ type: "scale", state: "connected" }]),
    ],
  })));
wss.get("/ws/v1/scale/snapshot").on("connection", (ws) => ws.send(JSON.stringify({ status: NO_SCALE ? "disconnected" : "connected" })));
wss.get("/ws/v1/machine/waterLevels").on("connection", (ws) => ws.send(JSON.stringify(fx.waterLevels)));

// Live streams.
setInterval(() => { maybeFinishMaintenance(); broadcast("/ws/v1/machine/snapshot", snapshot()); }, 250);
setInterval(() => {
  if (NO_SCALE) return; // no scale device -> no weight stream
  const flowing = FLOWING.has(state.machine.state) && state.shotStartedAt > 0;
  const elapsed = flowing ? (Date.now() - state.shotStartedAt) / 1000 : 0;
  broadcast("/ws/v1/scale/snapshot", {
    weight: flowing ? Math.round(elapsed * 1.2 * 10) / 10 : 0,
    weightFlow: flowing ? 1.2 : 0,
  });
}, 250);
setInterval(() => broadcast("/ws/v1/machine/waterLevels", fx.waterLevels), 5000);
setInterval(() => broadcast("/ws/v1/plugins/time-to-ready.reaplugin/timeToReady", timeToReady()), 250);

server.listen(PORT, () => {
  console.log(`Mock gateway on http://localhost:${PORT}`);
  console.log(`  web root: ${WEB_ROOT}`);
  console.log(`  PUT /api/v1/machine/state/espresso to start a simulated shot`);
  console.log(`  PUT /api/v1/machine/state/heating to simulate a ${HEATING_MS / 1000}s heat-up`);
  console.log(`  PUT /api/v1/machine/state/{cleaning,descaling} to simulate a ${MAINTENANCE_MS / 1000}s maintenance cycle`);
});
