// Covers what core does for gateway 0.9.2 (decaid): the token-gated management
// routes (#1142) surface as a recognisable auth error, skin switching inside
// the app goes through window.decentApp.switchSkin (#1111), and a refill-level
// write is read back through the new GET /machine/waterLevels (#1104).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => null });
loadCoreFile("core.js");
loadCoreFile("api.js");
loadCoreFile("domains/update.js");
const NSXApi = window.NSXApi;
const NSXCore = window.NSXCore;

test("a 401 from a management route rejects with status, and isAuthError recognises it", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) });
  const err = await NSXApi.setPluginEnabled("visualizer.reaplugin", true).catch((e) => e);
  assert.equal(err.status, 401);
  assert.equal(NSXApi.isAuthError(err), true);
  assert.equal(NSXApi.isAuthError({ status: 403 }), true, "the skin's account-proxy token gets 403");
  assert.equal(NSXApi.isAuthError({ status: 500 }), false);
  assert.equal(NSXApi.isAuthError(new Error("offline")), false);
});

test("switchToSkin hands the switch to the app when embedded, without touching REST", async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => null }; };
  const asked = [];
  window.decentApp = { switchSkin(id) { asked.push(id); return true; } };
  try {
    const r = await NSXCore.switchToSkin("streamline.js");
    assert.deepEqual(r, { url: null, port: null, native: true });
    assert.deepEqual(asked, ["streamline.js"]);
    assert.equal(calls.length, 0, "no PUT /webui/skins/default — it needs a token");
  } finally {
    delete window.decentApp;
  }
});

test("switchToSkin falls back to REST when switchSkin says it is not embedded", async () => {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => {
    calls.push(`${o.method || "GET"} ${url}`);
    return { ok: false, status: 401, json: async () => ({}) };
  };
  window.decentApp = { switchSkin: () => false }; // external browser
  try {
    const err = await NSXCore.switchToSkin("streamline.js").catch((e) => e);
    assert.ok(calls.some((c) => c.startsWith("PUT ") && c.endsWith("/api/v1/webui/skins/default")));
    assert.equal(NSXApi.isAuthError(err), true);
  } finally {
    delete window.decentApp;
  }
});

test("pushRefillLevel reads the levels back and emits them; a missing GET is not an error", async () => {
  const seen = [];
  const original = window.dispatchEvent; // the harness window's events are no-ops
  window.dispatchEvent = (e) => { if (e.type === "water:level") seen.push(e.detail); };
  try {
    globalThis.fetch = async (url, o = {}) => (o.method === "POST"
      ? { ok: true, status: 204, json: async () => null }
      : { ok: true, status: 200, json: async () => ({ currentLevel: 30, refillLevel: 12 }) });
    await NSXApi.pushRefillLevel(12);
    assert.deepEqual(seen.at(-1), { currentLevel: 30, refillLevel: 12 });

    const before = seen.length;
    globalThis.fetch = async (url, o = {}) => (o.method === "POST"
      ? { ok: true, status: 204, json: async () => null }
      : { ok: false, status: 404, json: async () => null }); // pre-0.9.2 gateway
    await NSXApi.pushRefillLevel(14);
    assert.equal(seen.length, before, "nothing emitted, and the write still resolved");
  } finally {
    window.dispatchEvent = original;
  }
});
