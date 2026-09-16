// Covers the update domain: version comparison, the GitHub release lookup
// (including the tag-prefix filter that keeps two release streams in one repo
// apart), and the skin update round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWindow, loadCoreFile } from "./harness.mjs";

setupWindow();
loadCoreFile("core.js");
loadCoreFile("domains/update.js");
const NSXCore = window.NSXCore;

/** Stub global fetch with a url -> {ok, body} map; records the urls hit. */
function stubFetch(routes) {
  NSXCore.clearReleaseCache(); // each test asks its own fresh question
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, json: async () => null };
    if (hit.throws) throw new Error("offline");
    return { ok: true, json: async () => hit };
  };
  return calls;
}

test("compareVersions tolerates a leading v, missing segments and prereleases", () => {
  const { compareVersions: cmp } = NSXCore;
  assert.equal(cmp("0.8.6", "0.8.6"), 0);
  assert.equal(cmp("v0.8.6", "0.8.6"), 0, "a leading v is not part of the version");
  assert.equal(cmp("0.8.6", "0.8.10"), -1, "10 > 6 numerically, not alphabetically");
  assert.equal(cmp("0.9", "0.9.0"), 0, "a missing patch segment reads as 0");
  assert.equal(cmp("1.0.0-beta.1", "1.0.0"), -1, "a release outranks its prerelease");
  assert.equal(cmp("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(cmp("", "1.0.0"), -1);
});

test("fetchLatestRelease reads tag_name from the /latest endpoint", async () => {
  stubFetch({ "https://api.github.com/repos/decentespresso/decaid/releases/latest": { tag_name: "v0.8.7" } });
  assert.equal(await NSXCore.fetchLatestRelease("decentespresso/decaid"), "v0.8.7");
});

test("a tag prefix picks the newest release of THAT stream, not the repo's newest", async () => {
  // This repo ships two skins: NSX tags 'v*', Nova tags 'nova-v*'. GitHub's own
  // "latest" would hand Nova the NSX release that happened to be published last.
  stubFetch({
    "https://api.github.com/repos/NilsBruch/NSX/releases?per_page=100": [
      { tag_name: "v0.4.3" },
      { tag_name: "nova-v0.2.0" },
      { tag_name: "nova-v0.10.0" },
      { tag_name: "nova-v0.9.0" },
      { tag_name: "nova-v0.11.0", draft: true },
    ],
  });
  assert.equal(
    await NSXCore.fetchLatestRelease("NilsBruch/NSX", { tagPrefix: "nova-v" }),
    "nova-v0.10.0",
    "0.10.0 beats 0.9.0 and 0.2.0; the NSX tag and the draft are not candidates",
  );
});

test("a repeated check re-asks GitHub instead of answering from the cache", async () => {
  const first = stubFetch({ "https://api.github.com/repos/decentespresso/decaid/releases/latest": { tag_name: "v0.8.7" } });
  await NSXCore.fetchLatestRelease("decentespresso/decaid");
  await NSXCore.fetchLatestRelease("decentespresso/decaid");
  assert.equal(first.length, 1, "a re-render is served from the cache");

  NSXCore.clearReleaseCache();
  await NSXCore.fetchLatestRelease("decentespresso/decaid");
  assert.equal(first.length, 2, "an explicit check goes back to GitHub");
});

test("an unreachable or empty GitHub answers null — never 'up to date'", async () => {
  stubFetch({});
  assert.equal(await NSXCore.fetchLatestRelease("nope/nope", { tagPrefix: "x-" }), null);
  assert.equal(await NSXCore.fetchLatestRelease("missing/repo"), null);
});

test("checkAppUpdate compares the running build against the newest release", async () => {
  window.NSXApi = { fetchGatewayInfo: async () => ({ version: "0.8.6" }) };
  stubFetch({ "https://api.github.com/repos/decentespresso/decaid/releases/latest": { tag_name: "v0.9.0" } });
  const r = await NSXCore.checkAppUpdate();
  assert.equal(r.updateAvailable, true);
  assert.equal(r.latest, "0.9.0");
  assert.equal(r.known, true);
});

test("checkAppUpdate says nothing when the release tag is unknown", async () => {
  window.NSXApi = { fetchGatewayInfo: async () => ({ version: "0.8.6" }) };
  stubFetch({}); // 404 -> null tag
  const r = await NSXCore.checkAppUpdate();
  assert.equal(r.known, false, "unknown must not be reported as up to date");
  assert.equal(r.updateAvailable, false);
});

const SKIN = {
  id: "Nova-skin",
  version: "v0.3.0",
  reaMetadata: { sourceUrl: "github_release:NilsBruch/NSX@nova-v0.3.0" },
};

test("parseSkinRepo reads the repo a skin was installed from", () => {
  assert.equal(NSXCore.parseSkinRepo(SKIN), "NilsBruch/NSX");
  assert.equal(NSXCore.parseSkinRepo({ id: "hand-copied" }), null, "no source metadata -> no signal");
});

test("checkSkinUpdate compares the ON-DISK version against the newest release", async () => {
  window.NSXApi = { fetchSkins: async () => [SKIN] };
  stubFetch({
    "https://api.github.com/repos/NilsBruch/NSX/releases?per_page=100": [{ tag_name: "nova-v0.4.0" }],
  });
  await NSXCore.loadSkins(true);
  const r = await NSXCore.checkSkinUpdate("Nova-skin", { tagPrefix: "nova-v" });
  assert.equal(r.installed, "0.3.0");
  assert.equal(r.latest, "0.4.0");
  assert.equal(r.updateAvailable, true);
  assert.equal(r.repo, "NilsBruch/NSX");
});

test("installSkinUpdate reports whether THIS skin's on-disk version changed", async () => {
  let posted = 0;
  let onDisk = "v0.3.0";
  window.NSXApi = {
    fetchSkins: async () => [{ ...SKIN, version: onDisk }],
    updateSkins: async () => { posted++; onDisk = "v0.4.0"; },
  };
  await NSXCore.loadSkins(true);

  const r = await NSXCore.installSkinUpdate("Nova-skin");
  assert.equal(posted, 1);
  assert.equal(r.updated, true);
  assert.equal(r.version, "0.4.0");

  // Nothing newer the second time: same version back, so no reload.
  const again = await NSXCore.installSkinUpdate("Nova-skin");
  assert.equal(again.updated, false);
  assert.equal(again.version, "0.4.0");
});
