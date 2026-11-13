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
 * Run: npm run dev:gateway   (runs sync-core first, then this)
 *      npm run dev:nsx       (same server, --static: skin only, no mock API)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import * as fx from "./fixtures.mjs";

// --static serves the skin only, leaving the API to whoever owns port 8080 —
// normally the real Decent app. core/config.js derives the gateway host from
// location.hostname but pins the port to 8080, so a skin served from :5174
// reaches the real machine with no ?gateway= override. Mirrors dev:nova.
const STATIC_ONLY = process.argv.includes("--static");
const PORT = Number(process.env.PORT || (STATIC_ONLY ? 5174 : 8080));

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
    `mock-gateway: no servable skin for --skin=${SKIN}
` +
    `  looked for index.html in ${join(SKIN_DIR, "dist")} and ${join(SKIN_DIR, "src")}
` +
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
  shotDetails: structuredClone(fx.shotDetails),
  store: structuredClone(fx.store),
  workflow: structuredClone(fx.currentWorkflow),
  skins: structuredClone(fx.skins),
  defaultSkinId: fx.skins[0].id,
  webuiPort: 3000,
  wifiScales: [],
  forgotten: new Set(),
  // Simulated shot progression
  shotStartedAt: 0,
  frameOffset: 0,
};

/* ── updates ──────────────────────────────────────────────
 * Nothing to update by default, which is the normal answer and the one the skin
 * has to handle gracefully. Set APP_UPDATE_TO / SKIN_UPDATE_TO to a version to
 * play the other side: an app update that can be installed in place (with
 * progress), and a skin whose files change on the next POST to
 * /webui/skins/update — which is what makes the skin reload into them.
 *   APP_UPDATE_TO=0.9.0 SKIN_UPDATE_TO=0.4.0 npm run dev:gateway
 */
const APP_UPDATE_TO = process.env.APP_UPDATE_TO || "";
const SKIN_UPDATE_TO = process.env.SKIN_UPDATE_TO || "";

const appUpdateState = {
  phase: "idle",
  currentVersion: fx.gatewayInfo.version,
  latestVersion: null,
  releaseNotes: null,
  releaseUrl: fx.gatewayInfo.releaseUrl,
  installable: false,
  progress: null,
  error: null,
};

/** Patch the shared state and push it to everyone watching the channel. */
function setUpdateState(patch) {
  Object.assign(appUpdateState, patch);
  broadcast("/ws/v1/update", appUpdateState);
}

/** The two devices this mock pretends are paired — the REST list and the
 *  WebSocket push below are both built from these, so they cannot disagree. */
const MOCK_DEVICES = [
  { name: "MockDe1", id: "MockDe1", type: "machine", state: "connected", available: true },
  { name: "Mock Scale", id: "MockScale", type: "scale", state: "connected", available: true },
];

const FLOWING = new Set(["espresso", "steam", "hotWater", "flush"]);
const FRAME_SECONDS = 6;

function setMachineState(next) {
  if (next === "skipStep") {
    state.frameOffset += 1; // advance one profile frame
    return;
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
}

/** Current simulated snapshot, driving the live graph + step progress. */
function snapshot() {
  const flowing = FLOWING.has(state.machine.state) && state.shotStartedAt > 0;
  const elapsed = flowing ? (Date.now() - state.shotStartedAt) / 1000 : 0;

  if (flowing && elapsed > 2) state.machine.substate = "pouring";
  if (flowing && elapsed > 45) setMachineState("idle");

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
    // The steam BOILER, in plain °C — the field NSX's steam orb and Nova's
    // steam readout/graph read. The mock carried none at all, so a steam
    // session here showed a dash where a machine shows a temperature. Sits at
    // its standby temperature and dips while steaming, the way a boiler under
    // draw does; the shape is approximate, its presence and units are not.
    steamTemperature: state.machine.state === "steam"
      ? Math.max(128, 152 - elapsed * 1.4)
      : 150 + Math.sin(Date.now() / 6000),
  };
}


/**
 * The shot-list filters the real gateway supports. Until this existed the mock
 * ignored every one of them and always returned the whole list — so a skin
 * scoping shots to a bean looked broken here while working against a machine,
 * which is exactly the mock-vs-reality gap the fixtures were regenerated to
 * close. Verified against the live API: `search` is a case-insensitive
 * substring across coffee name, roaster, profile title, grinder model and
 * notes, while profileTitle/coffeeName/… match exactly.
 */
function filterShots(list, q) {
  const ctxOf = (s) => s?.workflow?.context || {};
  const titleOf = (s) => s?.workflow?.profile?.title || s?.workflow?.profileTitle || "";

  // beanId isn't stored on a shot — it is reached through the bag it was
  // pulled from, the same hop the skin's own batch->bean map makes.
  const beanIdOf = (s) => {
    const batchId = ctxOf(s).beanBatchId;
    if (!batchId) return null;
    for (const [beanId, batches] of Object.entries(state.beanBatches)) {
      if ((batches || []).some((b) => b?.id === batchId)) return beanId;
    }
    return null;
  };

  const eq = (param, read) => {
    const want = q.get(param);
    if (!want) return null;
    return (s) => String(read(s) ?? "") === want;
  };

  const tests = [
    eq("beanId", beanIdOf),
    eq("beanBatchId", (s) => ctxOf(s).beanBatchId),
    eq("coffeeName", (s) => ctxOf(s).coffeeName),
    eq("coffeeRoaster", (s) => ctxOf(s).coffeeRoaster),
    eq("grinderId", (s) => ctxOf(s).grinderId),
    eq("grinderModel", (s) => ctxOf(s).grinderModel),
    eq("profileTitle", titleOf),
  ].filter(Boolean);

  // minEnjoyment: inclusive, on the same 0-10 scale PUT accepts; unrated shots
  // never match. Validated by the route below (a bad value is a 400).
  if (q.has("minEnjoyment")) {
    const min = Number(q.get("minEnjoyment"));
    tests.push((s) => {
      const e = s?.annotations?.enjoyment;
      return e != null && Number(e) >= min;
    });
  }

  const search = (q.get("search") || "").trim().toLowerCase();
  if (search) {
    tests.push((s) => [
      ctxOf(s).coffeeName, ctxOf(s).coffeeRoaster, titleOf(s),
      ctxOf(s).grinderModel, s?.annotations?.espressoNotes,
    ].some((v) => String(v ?? "").toLowerCase().includes(search)));
  }

  return tests.length ? list.filter((s) => tests.every((t) => t(s))) : list;
}

/**
 * Newest first by default; `order=asc` flips it. Ordering happens BEFORE the
 * limit/offset slice, exactly as the real gateway does it, so page 0 of an
 * ascending query is the genuinely OLDEST shots rather than the newest page
 * turned around.
 *
 * Verified against the live API, including its quirks: the match is
 * case-SENSITIVE and only 'asc' means anything. 'ASC', 'oldest', 'banana' all
 * come back newest-first with a 200 and no complaint. Reproduced here rather
 * than tidied up, because a mock that accepted 'ASC' would let a skin ship a
 * sort that silently does nothing on a real machine.
 */
function sortShots(list, q) {
  const asc = q.get("order") === "asc";
  const at = (s) => Date.parse(s?.timestamp || 0) || 0;
  return list.slice().sort((a, b) => (asc ? at(a) - at(b) : at(b) - at(a)));
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
  if (path === "/api/v1/machine/waterLevels") {
    if (method === "POST" && Number.isFinite(Number(body?.refillLevel))) {
      fx.waterLevels.refillLevel = Number(body.refillLevel);
    }
    return json(fx.waterLevels);
  }
  if (path === "/api/v1/machine/settings") return method === "GET" ? json({}) : noContent();

  // ── workflow ──
  if (path === "/api/v1/workflow/current" && method === "GET") return json(state.workflow);
  if (path === "/api/v1/workflow" && (method === "PUT" || method === "POST")) {
    state.workflow = body ?? state.workflow;
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
    const now = new Date().toISOString();
    const rec = { id: `bean:${Date.now()}`, archived: false, createdAt: now, updatedAt: now, ...body };
    state.beans.push(rec);
    return json(rec, 201);
  }
  if (path.startsWith("/api/v1/beans/") && !path.includes("/batches") && method === "PUT") {
    const id = decodeURIComponent(path.split("/")[4]);
    const i = state.beans.findIndex((b) => b.id === id);
    if (i < 0) return json({ message: "not found" }, 404);
    state.beans[i] = { ...state.beans[i], ...body, id, updatedAt: new Date().toISOString() };
    return json(state.beans[i]);
  }
  if (path.startsWith("/api/v1/beans/") && !path.includes("/batches") && method === "DELETE") {
    const id = decodeURIComponent(path.split("/")[4]);
    const i = state.beans.findIndex((b) => b.id === id);
    if (i >= 0) state.beans.splice(i, 1);
    // The real gateway refuses a bean delete while it still has batches (see
    // NSXCore.deleteBean) — the client clears them first via DELETE
    // /bean-batches/{id}, so this route doesn't need to cascade itself.
    delete state.beanBatches[id];
    return noContent();
  }
  const batchMatch = path.match(/^\/api\/v1\/beans\/([^/]+)\/batches$/);
  if (batchMatch && method === "GET") {
    const beanId = decodeURIComponent(batchMatch[1]);
    const incl = q.get("includeArchived") === "true";
    const list = state.beanBatches[beanId] ?? [];
    return jsonEtag(incl ? list : list.filter((b) => !b.archived));
  }
  if (batchMatch && method === "POST") {
    const beanId = decodeURIComponent(batchMatch[1]);
    const now = new Date().toISOString();
    const rec = { id: `batch:${Date.now()}`, beanId, frozen: false, archived: false, createdAt: now, updatedAt: now, ...body };
    if (!state.beanBatches[beanId]) state.beanBatches[beanId] = [];
    state.beanBatches[beanId].push(rec);
    return json(rec, 201);
  }
  // A bag's own id doesn't carry its beanId in the URL, so every /bean-batches/{id}
  // route has to search across state.beanBatches — same hop beanIdOf() above makes.
  const findBatch = (id) => {
    for (const list of Object.values(state.beanBatches)) {
      const b = (list || []).find((x) => x?.id === id);
      if (b) return b;
    }
    return null;
  };
  if (path.startsWith("/api/v1/bean-batches/") && method === "GET") {
    const rec = findBatch(decodeURIComponent(path.split("/")[4]));
    return rec ? json(rec) : json({ message: "not found" }, 404);
  }
  if (path.startsWith("/api/v1/bean-batches/") && method === "PUT") {
    const id = decodeURIComponent(path.split("/")[4]);
    const rec = findBatch(id);
    if (!rec) return json({ message: "not found" }, 404);
    Object.assign(rec, body, { id, updatedAt: new Date().toISOString() });
    return json(rec);
  }
  if (path.startsWith("/api/v1/bean-batches/") && method === "DELETE") {
    const id = decodeURIComponent(path.split("/")[4]);
    for (const list of Object.values(state.beanBatches)) {
      const i = (list || []).findIndex((b) => b?.id === id);
      if (i >= 0) { list.splice(i, 1); break; }
    }
    return noContent();
  }
  if (path === "/api/v1/grinders" && method === "GET") return jsonEtag(state.grinders);

  // ── shots ──
  if (path === "/api/v1/shots" && method === "GET") {
    // Rejected exactly as the real gateway rejects them (decaid 283563c):
    // minEnjoyment outside 0-10 or non-numeric, and `ids` combined with any
    // other filter.
    if (q.has("minEnjoyment")) {
      const min = Number(q.get("minEnjoyment"));
      if (q.get("minEnjoyment") === "" || !Number.isFinite(min) || min < 0 || min > 10) {
        return json({ message: "minEnjoyment must be a number between 0 and 10" }, 400);
      }
    }
    const FILTERS = ["grinderId", "grinderModel", "beanId", "beanBatchId", "coffeeName",
      "coffeeRoaster", "profileTitle", "search", "minEnjoyment"];
    if (q.has("ids") && FILTERS.some((f) => q.has(f))) {
      return json({ message: "ids cannot be combined with other filters" }, 400);
    }
    const limit = Number(q.get("limit") ?? 20);
    const offset = Number(q.get("offset") ?? 0);
    const filtered = sortShots(filterShots(state.shots, q), q);
    return jsonEtag({ items: filtered.slice(offset, offset + limit), total: filtered.length });
  }
  // Only THIS endpoint carries measurements — the list above does not, exactly
  // as the real gateway behaves. Serving fuller shots from the list would let
  // a skin read `measurements` off a list shot and still work here while
  // failing against a real machine.
  if (path.startsWith("/api/v1/shots/") && method === "GET") {
    const id = decodeURIComponent(path.split("/")[4]);
    const s = state.shotDetails[id];
    return s ? json(s) : json({ message: "not found" }, 404);
  }
  if (path.startsWith("/api/v1/shots/") && method === "PUT") {
    const id = decodeURIComponent(path.split("/")[4]);
    const s = state.shots.find((x) => x.id === id);
    if (!s) return json({ message: "not found" }, 404);
    // The real API rejects a rating off its 0-10 scale (decaid PR #887). The
    // mock accepting 0-100 is how two skins went on writing ratings the real
    // gateway refused with a 400.
    const e = body?.annotations?.enjoyment;
    if (e != null && !(Number.isFinite(Number(e)) && Number(e) >= 0 && Number(e) <= 10)) {
      return json({ message: "annotations.enjoyment must be between 0 and 10" }, 400);
    }
    // The real API merges `extras` at field level.
    const merge = (target) => {
      if (!target?.annotations && !body?.annotations) return;
      target.annotations = {
        ...target.annotations,
        ...body.annotations,
        extras: { ...target.annotations?.extras, ...body.annotations?.extras },
      };
    };
    if (body?.annotations) {
      merge(s);
      if (state.shotDetails[id]) merge(state.shotDetails[id]);
    }
    return json(s);
  }
  if (path.startsWith("/api/v1/shots/") && method === "DELETE") {
    const id = decodeURIComponent(path.split("/")[4]);
    const i = state.shots.findIndex((x) => x.id === id);
    if (i >= 0) state.shots.splice(i, 1);
    delete state.shotDetails[id];
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

  // ── build info / updates ──
  // The skin's update card is built from these three plus ws/v1/update below.
  if (path === "/api/v1/info") return json(fx.gatewayInfo);
  if (path === "/api/v1/update") return json(appUpdateState);
  if (path === "/api/v1/webui/skins" && method === "GET") return json(state.skins);
  if (path === "/api/v1/webui/skins/default" && method === "GET") {
    return json(state.skins.find((s) => s.id === state.defaultSkinId) ?? state.skins[0]);
  }
  if (path === "/api/v1/webui/skins/default" && method === "PUT") {
    // The real gateway re-serves the new folder on a fresh port; the skin reads
    // that back rather than assuming, so the mock moves the port too.
    state.defaultSkinId = body?.skinId ?? state.defaultSkinId;
    state.webuiPort = 3000 + Math.floor(Math.random() * 1000);
    return json(state.skins.find((s) => s.id === state.defaultSkinId) ?? null);
  }
  if (path === "/api/v1/webui/server/status") {
    return json({
      serving: true,
      path: `/web-ui/${state.defaultSkinId}`,
      port: state.webuiPort,
      ip: "localhost",
    });
  }
  if (path === "/api/v1/webui/skins/update" && method === "POST") {
    // What the real bridge does: re-download from each skin's recorded source.
    // Here, bump whatever SKIN_UPDATE_TO says so the reload path is exercisable.
    if (SKIN_UPDATE_TO) {
      for (const skin of state.skins) if (skin.reaMetadata) skin.version = SKIN_UPDATE_TO;
    }
    return json({ updated: !!SKIN_UPDATE_TO });
  }

  // ── misc ──
  if (path === "/api/v1/scale/tare") return noContent();
  if (path === "/api/v1/devices/scan") return noContent();
  // The REST list a settings screen reads (the WebSocket push below is the live
  // one). A forgotten device is gone from it until a scan finds it again.
  if (path === "/api/v1/devices" && method === "GET") {
    return json(MOCK_DEVICES.filter((d) => !state.forgotten.has(d.id)));
  }
  // Forgetting drops the pairing: the device leaves the list until a scan finds
  // it again — which is what makes the confirm in the skin worth having.
  if (path === "/api/v1/devices/forget" && method === "PUT") {
    state.forgotten.add(body?.deviceId);
    return noContent();
  }
  if (path === "/api/v1/devices/wifi") {
    if (method === "POST" && body?.host) state.wifiScales.push(String(body.host));
    if (method === "DELETE") state.wifiScales = state.wifiScales.filter((h) => h !== body?.host);
    return json({ endpoints: state.wifiScales });
  }
  if (path === "/api/v1/presence/schedules") return method === "GET" ? json([]) : json(body ?? {}, 201);
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

  if (STATIC_ONLY || !url.pathname.startsWith("/api/")) return void serveStatic(url, res);

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
  "/ws/v1/update",
];

const wss = new Map(WS_PATHS.map((p) => [p, new WebSocketServer({ noServer: true })]));

server.on("upgrade", (req, socket, head) => {
  if (STATIC_ONLY) return void socket.destroy();
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

// Announce connected devices + scale status on connect.
wss.get("/ws/v1/devices").on("connection", (ws) =>
  ws.send(JSON.stringify({ devices: MOCK_DEVICES.filter((d) => !state.forgotten.has(d.id)) })));
wss.get("/ws/v1/scale/snapshot").on("connection", (ws) => ws.send(JSON.stringify({ status: "connected" })));

/* App-update channel: a snapshot on connect, then one on every state change,
 * and { command } back the other way — the same two-way shape the real gateway
 * has. `install` runs a fake download so the progress bar can be seen; it is
 * offered only when APP_UPDATE_TO is set, mirroring `installable` being false
 * on every platform but Android. */
wss.get("/ws/v1/update").on("connection", (ws) => {
  ws.send(JSON.stringify(appUpdateState));
  ws.on("message", (raw) => {
    let command = null;
    try { command = JSON.parse(String(raw))?.command; } catch { /* ignore */ }

    if (command === "check") {
      setUpdateState({ phase: "checking" });
      setTimeout(() => setUpdateState(APP_UPDATE_TO
        ? { phase: "available", latestVersion: APP_UPDATE_TO, installable: true }
        : { phase: "idle", latestVersion: null, installable: false }), 400);
      return;
    }

    if (command === "install") {
      if (!appUpdateState.installable) {
        return void ws.send(JSON.stringify({ error: "No update to install", url: fx.gatewayInfo.releaseUrl }));
      }
      let pct = 0;
      const tick = setInterval(() => {
        pct += 0.2;
        if (pct < 1) return setUpdateState({ phase: "downloading", progress: pct });
        clearInterval(tick);
        setUpdateState({ phase: "installing", progress: 1 });
        setTimeout(() => setUpdateState({ phase: "idle", progress: null, installable: false, latestVersion: null }), 600);
      }, 400);
      return;
    }

    ws.send(JSON.stringify({ error: `mock: unknown command ${command}` }));
  });
});
wss.get("/ws/v1/machine/waterLevels").on("connection", (ws) => ws.send(JSON.stringify(fx.waterLevels)));

// Live streams.
if (!STATIC_ONLY) {
  setInterval(() => broadcast("/ws/v1/machine/snapshot", snapshot()), 250);
  setInterval(() => {
    const flowing = FLOWING.has(state.machine.state) && state.shotStartedAt > 0;
    const elapsed = flowing ? (Date.now() - state.shotStartedAt) / 1000 : 0;
    broadcast("/ws/v1/scale/snapshot", {
      weight: flowing ? Math.round(elapsed * 1.2 * 10) / 10 : 0,
      weightFlow: flowing ? 1.2 : 0,
    });
  }, 250);
  setInterval(() => broadcast("/ws/v1/machine/waterLevels", fx.waterLevels), 5000);
}

server.listen(PORT, () => {
  if (STATIC_ONLY) {
    console.log(`NSX skin on http://localhost:${PORT}`);
    console.log(`  web root: ${WEB_ROOT}`);
    console.log(`  gateway:  http://localhost:8080 (whatever owns that port)`);
    return;
  }
  console.log(`Mock gateway on http://localhost:${PORT}`);
  console.log(`  web root: ${WEB_ROOT}`);
  console.log(`  PUT /api/v1/machine/state/espresso to start a simulated shot`);
});
