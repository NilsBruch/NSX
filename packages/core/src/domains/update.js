"use strict";
/**
 * NSXCore update domain — "is something newer than what is running?", for both
 * the Decent app (Decaid) and the skin itself.
 *
 * Two independent questions, deliberately answered by different means:
 *
 *  1. IS THERE A NEWER BUILD?  Asked of GitHub, not of the gateway. Decaid's own
 *     update checker never runs on macOS (Sparkle owns updates there) and reports
 *     phase "idle" with a null latestVersion on desktop, so a badge driven off
 *     GET /api/v1/update is blank on exactly the platforms people use. Comparing
 *     the running build against the newest release tag of the repo works
 *     everywhere and needs nothing from the gateway. (The Streamline skin reaches
 *     the same conclusion for the same reason.)
 *  2. INSTALL IT. That one only the gateway can do — for the app over the
 *     ws/v1/update command channel (Android only; elsewhere `installable` is
 *     false and the release page is the only way through), and for skins over
 *     POST /api/v1/webui/skins/update, which re-downloads from each skin's
 *     recorded source.
 *
 * Release lookups are cached per repo for the page's lifetime and fail soft:
 * offline, rate-limited or no releases all resolve to null, which every caller
 * must read as "nothing to report" rather than "up to date".
 *
 * It also owns the installed-skin list, and therefore which skin the gateway
 * serves: switching skins is the same list, asked a different question.
 *
 * Registered on NSXCore:
 *   Selectors: compareVersions(a, b), parseSkinRepo(skin)
 *   Commands:  fetchLatestRelease(repo, {tagPrefix}), clearReleaseCache(),
 *              checkAppUpdate(),
 *              loadSkins(force), findSkin(skinId), checkSkinUpdate(skinId, opts),
 *              installSkinUpdate(), loadActiveSkinId(), switchToSkin(skinId)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.update] core.js must load before domains/update.js");
    return;
  }

  /** The app's own repo — its tags ('v0.8.6') compare against GET /api/v1/info. */
  const DECAID_REPO = "decentespresso/decaid";
  const DECAID_RELEASES_URL = "https://github.com/decentespresso/decaid/releases";

  /**
   * Semver-ish compare: -1 / 0 / 1. Tolerates a leading 'v', a missing patch
   * segment and a prerelease suffix (1.0.0 outranks 1.0.0-beta.1).
   */
  function compareVersions(a, b) {
    const parse = (v) => {
      const [core, pre] = String(v || "").trim().replace(/^v/i, "").split("-");
      return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre || "" };
    };
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.nums.length, pb.nums.length);
    for (let i = 0; i < len; i++) {
      const d = (pa.nums[i] || 0) - (pb.nums[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    if (pa.pre && !pb.pre) return -1;
    if (!pa.pre && pb.pre) return 1;
    if (pa.pre && pb.pre) {
      const c = pa.pre.localeCompare(pb.pre, undefined, { numeric: true });
      return c < 0 ? -1 : c > 0 ? 1 : 0;
    }
    return 0;
  }

  const _releaseCache = new Map(); // `${repo}|${tagPrefix}` -> tag string | null
  const _releaseInFlight = new Map(); // same key -> Promise

  /**
   * The newest release tag of a GitHub repo, or null when it can't be known.
   *
   * `tagPrefix` is what makes this usable for a repo that carries more than one
   * release stream: this repo tags NSX 'v*' and Nova 'nova-v*', so
   * /releases/latest would hand Nova whichever skin released last. With a prefix
   * the release LIST is filtered and the highest version among the matches wins —
   * GitHub's own "latest" flag can't express "latest of this stream".
   *
   * @param {string} repo       "owner/name"
   * @param {{tagPrefix?: string}} [opts]
   * @returns {Promise<string|null>} e.g. "v0.8.6" / "nova-v0.4.0"
   */
  async function fetchLatestRelease(repo, { tagPrefix = "" } = {}) {
    if (!repo) return null;
    const key = `${repo}|${tagPrefix}`;
    if (_releaseCache.has(key)) return _releaseCache.get(key);
    if (_releaseInFlight.has(key)) return _releaseInFlight.get(key);

    const url = tagPrefix
      ? `https://api.github.com/repos/${repo}/releases?per_page=100`
      : `https://api.github.com/repos/${repo}/releases/latest`;

    const run = fetch(url, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!tagPrefix) return data?.tag_name?.trim() || null;
        const tags = (Array.isArray(data) ? data : [])
          .filter((rel) => !rel?.draft && String(rel?.tag_name || "").startsWith(tagPrefix))
          .map((rel) => String(rel.tag_name).trim());
        if (tags.length === 0) return null;
        return tags.reduce((best, tag) =>
          compareVersions(stripPrefix(tag, tagPrefix), stripPrefix(best, tagPrefix)) > 0 ? tag : best);
      })
      .catch(() => null)
      .then((tag) => {
        _releaseCache.set(key, tag);
        _releaseInFlight.delete(key);
        return tag;
      });

    _releaseInFlight.set(key, run);
    return run;
  }

  /**
   * Forget the cached release tags, so the next lookup really asks GitHub.
   * The cache exists so a re-render costs nothing; a person pressing "check"
   * is asking a fresh question and must not be answered from it.
   */
  function clearReleaseCache() {
    _releaseCache.clear();
  }

  /** "nova-v0.4.0" + "nova-v" -> "0.4.0" (also strips a bare leading 'v'). */
  function stripPrefix(tag, prefix) {
    const t = String(tag || "");
    return (prefix && t.startsWith(prefix) ? t.slice(prefix.length) : t).replace(/^v/i, "");
  }

  /**
   * Is a newer Decent app released than the one running?
   * `known` is false when the running version or the release tag couldn't be
   * read — say nothing then rather than claim "up to date".
   * @returns {Promise<{current: string, latest: string|null, known: boolean, updateAvailable: boolean, releasesUrl: string}>}
   */
  async function checkAppUpdate() {
    const { fetchGatewayInfo } = window.NSXApi || {};
    const info = typeof fetchGatewayInfo === "function"
      ? await fetchGatewayInfo().catch(() => null)
      : null;
    const current = String(info?.version || "");
    const tag = await fetchLatestRelease(DECAID_REPO);
    const latest = tag ? stripPrefix(tag, "") : null;
    const known = !!current && !!latest;
    return {
      current,
      latest,
      known,
      updateAvailable: known && compareVersions(current, latest) < 0,
      releasesUrl: DECAID_RELEASES_URL,
    };
  }

  /* ── Skins ─────────────────────────────────────────────── */

  let _skins = null;

  /** Every installed skin as the gateway reports it (cached; `force` re-reads). */
  async function loadSkins(force = false) {
    if (_skins && !force) return _skins;
    const { fetchSkins } = window.NSXApi || {};
    if (typeof fetchSkins !== "function") return (_skins = []);
    _skins = await fetchSkins().catch(() => []);
    return _skins;
  }

  async function findSkin(skinId) {
    const skins = await loadSkins();
    return skins.find((s) => s?.id === skinId) || null;
  }

  /**
   * "owner/repo" a skin was installed from, or null when it wasn't installed
   * from a GitHub release (a hand-copied folder has no source to check).
   * Shape: "github_release:owner/repo@v1.2.3".
   */
  function parseSkinRepo(skin) {
    const m = String(skin?.reaMetadata?.sourceUrl || "").match(/github_release:([^@\s]+)/i);
    return m ? m[1] : null;
  }

  /**
   * Is a newer release of this skin published than the one on disk?
   *
   * The installed version comes from the GATEWAY's skin list, not from the
   * running bundle's build constant: after an update the new files are on disk
   * while the old bundle is still in the tab, and the disk version is what says
   * whether the update landed.
   *
   * @param {string} skinId
   * @param {{repo?: string, tagPrefix?: string, force?: boolean}} [opts] repo
   *        defaults to the one recorded at install time; tagPrefix picks this
   *        skin's tag stream; force re-reads the gateway's skin list.
   */
  async function checkSkinUpdate(skinId, { repo = null, tagPrefix = "", force = false } = {}) {
    if (force) await loadSkins(true);
    const skin = await findSkin(skinId);
    const installed = String(skin?.version || "");
    const slug = repo || parseSkinRepo(skin);
    const tag = slug ? await fetchLatestRelease(slug, { tagPrefix }) : null;
    const latest = tag ? stripPrefix(tag, tagPrefix) : null;
    const known = !!installed && !!latest;
    return {
      installed: installed.replace(/^v/i, ""),
      latest,
      known,
      updateAvailable: known && compareVersions(installed, latest) < 0,
      repo: slug,
      releasesUrl: slug ? `https://github.com/${slug}/releases` : null,
    };
  }

  /**
   * Have the gateway re-download every skin whose source has something newer,
   * then report what this one ended up at.
   *
   * There is no per-skin endpoint — the bridge checks them all — so the answer
   * is framed as "did THIS skin's on-disk version change", which is what decides
   * whether the caller should reload the page.
   *
   * @param {string} skinId
   * @returns {Promise<{updated: boolean, version: string}>}
   */
  async function installSkinUpdate(skinId) {
    const { updateSkins } = window.NSXApi || {};
    if (typeof updateSkins !== "function") throw new Error("NSXApi.updateSkins not available");
    const before = String((await findSkin(skinId))?.version || "");
    await updateSkins();
    const after = String((await loadSkins(true)).find((s) => s?.id === skinId)?.version || before);
    return { updated: !!after && after !== before, version: after.replace(/^v/i, "") };
  }

  /* ── Which skin the gateway serves ─────────────────────── */

  /** The id of the skin the gateway currently serves, or null if it won't say. */
  async function loadActiveSkinId() {
    const { fetchDefaultSkin } = window.NSXApi || {};
    if (typeof fetchDefaultSkin !== "function") return null;
    const skin = await fetchDefaultSkin().catch(() => null);
    return skin?.id ?? null;
  }

  /**
   * Serve a different skin, and say where the browser should go.
   *
   * The gateway binds a FRESH port every time it starts serving a folder, so
   * the URL this page is on is not where the new skin will be — the port has to
   * be read back. It takes a moment to come up, so the status is polled briefly
   * and checked against the requested skin rather than trusted on first answer;
   * a stale reading would send the user straight back into the skin they just
   * left.
   *
   * The host comes from the configured gateway, not from the status response:
   * the gateway reports `ip: "localhost"`, which is wrong for every tablet or
   * phone reaching it across the network.
   *
   * @param {string} skinId
   * @returns {Promise<{url: string|null, port: number|null}>} url is null when
   *          the new port never showed up — the switch still happened, so the
   *          caller should say so rather than navigate somewhere wrong.
   */
  async function switchToSkin(skinId) {
    const { setDefaultSkin, fetchWebuiServerStatus } = window.NSXApi || {};
    if (typeof setDefaultSkin !== "function") throw new Error("NSXApi.setDefaultSkin not available");
    await setDefaultSkin(skinId);
    _skins = null; // the list carries which one is served

    const wanted = String(skinId).toLowerCase();
    let status = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      status = typeof fetchWebuiServerStatus === "function"
        ? await fetchWebuiServerStatus().catch(() => null)
        : null;
      // `path` is the folder being served; its last segment is the skin id.
      const serving = String(status?.path || "").replace(/[\/]+$/, "").split(/[\/]/).pop().toLowerCase();
      if (status?.serving && status?.port && serving === wanted) break;
      status = null;
    }
    if (!status) return { url: null, port: null };

    let host = "";
    try { host = new URL(window.NSXConfig?.GATEWAY || "").hostname; } catch { /* fall through */ }
    if (!host) return { url: null, port: status.port };
    return { url: `http://${host}:${status.port}/?_=${Date.now()}`, port: status.port };
  }

  NSXCore.register({
    loadActiveSkinId,
    switchToSkin,
    compareVersions,
    fetchLatestRelease,
    clearReleaseCache,
    checkAppUpdate,
    loadSkins,
    findSkin,
    parseSkinRepo,
    checkSkinUpdate,
    installSkinUpdate,
  });
})();
