// Covers fetchShots' `order` parameter — the one that makes "oldest first" a
// real query rather than a page reversed in the browser.
//
// The rule worth a test is the NORMALISATION, not the happy path. The gateway
// accepts only lowercase 'asc' and silently answers 200-with-newest-first for
// anything else ('ASC', 'oldest', a typo), so a value passed straight through
// would produce a wrong sort with nothing to notice. These assert that only
// 'asc' ever reaches the wire, in that exact spelling, and that the parameter
// is absent — not 'desc' — otherwise, matching the API's own default.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();

const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  return {
    ok: true,
    status: 200,
    headers: { get: () => null }, // no ETag: keeps every call a real request
    json: async () => ({ items: [], total: 0 }),
  };
};

loadCoreFile("core.js");
loadCoreFile("api.js");
const NSXApi = window.NSXApi;

const lastQuery = () => new URL(requests[requests.length - 1], "http://x").searchParams;

test("fetchShots sends order=asc for an ascending query", async () => {
  await NSXApi.fetchShots({ limit: 20, offset: 0, order: "asc" });
  assert.equal(lastQuery().get("order"), "asc");
});

test("fetchShots omits order entirely for descending — the gateway's own default", async () => {
  await NSXApi.fetchShots({ limit: 20, offset: 0, order: "desc" });
  assert.equal(lastQuery().get("order"), null);
  await NSXApi.fetchShots({ limit: 20, offset: 0 });
  assert.equal(lastQuery().get("order"), null, "no order key at all when none was asked for");
});

test("fetchShots normalises the casing the gateway is fussy about", async () => {
  // 'ASC' reaching the gateway verbatim comes back newest-first with a 200 —
  // a silently wrong sort. Lowercased here so the caller's casing can't matter.
  await NSXApi.fetchShots({ limit: 20, offset: 0, order: "ASC" });
  assert.equal(lastQuery().get("order"), "asc");
  await NSXApi.fetchShots({ limit: 20, offset: 0, order: "Asc" });
  assert.equal(lastQuery().get("order"), "asc");
});

test("fetchShots drops a value the gateway would ignore anyway", async () => {
  for (const bad of ["oldest", "ascending", "banana", "", null, undefined]) {
    await NSXApi.fetchShots({ limit: 20, offset: 0, order: bad });
    assert.equal(lastQuery().get("order"), null, `order=${bad} must not reach the wire`);
  }
});

test("fetchShots keeps order alongside paging and search", async () => {
  await NSXApi.fetchShots({ limit: 20, offset: 40, search: "Diamond", order: "asc" });
  const q = lastQuery();
  assert.equal(q.get("order"), "asc");
  assert.equal(q.get("offset"), "40");
  assert.equal(q.get("search"), "Diamond");
});

test("the positional call signature is untouched by any of this", async () => {
  await NSXApi.fetchShots(50, 10, "Brazil");
  const q = lastQuery();
  assert.equal(q.get("limit"), "50");
  assert.equal(q.get("offset"), "10");
  assert.equal(q.get("search"), "Brazil");
  assert.equal(q.get("order"), null);
});
