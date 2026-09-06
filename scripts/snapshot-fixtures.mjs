/**
 * Regenerate the mock gateway's fixtures from a REAL gateway.
 *
 *   node scripts/snapshot-fixtures.mjs            # against http://localhost:8080
 *   GATEWAY=http://192.168.1.50:8080 node scripts/snapshot-fixtures.mjs
 *
 * Why this exists: the fixtures used to be written by hand, so they drifted
 * from the gateway silently. Beans really carry createdAt/updatedAt and the
 * fixtures never did, which is how a "sort suggestions by newest" question
 * ended up unanswerable from the code. Worse, the hand-written shots used a
 * flat measurements array the gateway has never returned.
 *
 * Read-only: this only ever issues GETs.
 *
 * Scope — gateway-OWNED entities only (their shape is not ours to choose):
 * machine info/state, beans, batches, grinders, profiles, shots. The KV store
 * is deliberately NOT snapshotted: it holds the skin's own settings and the
 * user's recipes, and this repo is public.
 *
 * Free-text that identifies real coffee (roaster, bean, producer, notes, …) is
 * replaced with stable placeholders for the same reason. Field NAMES, types,
 * empty strings, nulls and timestamps are preserved verbatim — the shape is
 * the whole point.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GATEWAY = process.env.GATEWAY || "http://localhost:8080";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "mock-gateway", "fixtures.mjs");

// How much to keep. Enough to exercise lists and grouping, small enough to read.
const MAX_PROFILES = 3;
const MAX_BEANS = 3;
const MAX_GRINDERS = 2;
const MAX_SHOTS = 3;
const MAX_MEASUREMENTS = 40;

async function get(path) {
  const res = await fetch(`${GATEWAY}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

/* ── anonymisation ──────────────────────────────────────── */

// Stable per run AND across runs: the nth distinct value of a field is always
// given the nth placeholder, so regenerating produces a minimal diff.
const pools = new Map();
function placeholder(field, value) {
  if (typeof value !== "string" || value.trim() === "") return value;
  if (!pools.has(field)) pools.set(field, new Map());
  const pool = pools.get(field);
  if (!pool.has(value)) pool.set(value, `${FIELD_LABELS[field]} ${pool.size + 1}`);
  return pool.get(value);
}

// Only fields that name a real-world thing. Enum-ish values (processing,
// species, country, settingType) stay real: they are shape, not identity.
// NOTE: `name` is deliberately absent. It means "bean" on a bean but "step" on
// a profile frame, and blanking step names would throw away real shape for no
// privacy gain. Bean names are anonymised explicitly at the call site instead.
const FIELD_LABELS = {
  roaster: "Roaster",
  beanName: "Bean",
  coffeeRoaster: "Roaster",
  coffeeName: "Bean",
  producer: "Producer",
  region: "Region",
  notes: "Notes",
  espressoNotes: "Notes",
  title: "Profile",
  author: "Author",
  model: "Grinder",
  burrs: "Burrs",
  serialNumber: "serial",
  serial: "serial",
};

// Anonymise a bean's `name` without touching every other `name` in the tree.
// Assigning over the existing key keeps the API's field order intact.
const scrubBean = (bean) => {
  const out = scrub(bean);
  out.name = placeholder("beanName", bean.name);
  return out;
};

function scrub(value, field) {
  if (Array.isArray(value)) return value.map((v) => scrub(v, field));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  return field in FIELD_LABELS ? placeholder(field, value) : value;
}

/* ── emit ───────────────────────────────────────────────── */

const lit = (v) => JSON.stringify(v, null, 2).replace(/\n/g, "\n");

function section(name, value, comment) {
  return `${comment ? `${comment}\n` : ""}export const ${name} = ${lit(value)};\n`;
}

/* ── main ───────────────────────────────────────────────── */

const machineInfo = scrub(await get("/api/v1/machine/info"));
const machineState = await get("/api/v1/machine/state");

const beansAll = await get("/api/v1/beans");
const beans = beansAll.slice(0, MAX_BEANS).map(scrubBean);

const beanBatches = {};
for (const bean of beans) {
  beanBatches[bean.id] = scrub(await get(`/api/v1/beans/${encodeURIComponent(bean.id)}/batches`));
}

const grinders = scrub((await get("/api/v1/grinders")).slice(0, MAX_GRINDERS));

const profilesAll = await get("/api/v1/profiles");
const profiles = scrub((Array.isArray(profilesAll) ? profilesAll : profilesAll.items || []).slice(0, MAX_PROFILES));

// The LIST endpoint really does omit measurements — only GET /shots/{id}
// carries them. Snapshot both so the mock can reproduce that difference
// instead of handing every list shot a full measurement array.
const shotList = await get(`/api/v1/shots?limit=${MAX_SHOTS}`);
const listItems = (shotList.items || []).slice(0, MAX_SHOTS);

const fullShots = [];
for (const s of listItems) {
  const full = await get(`/api/v1/shots/${encodeURIComponent(s.id)}`);
  const m = full.measurements || [];
  // Even sample rather than the first N, so the curve keeps its overall shape.
  const stride = Math.max(1, Math.ceil(m.length / MAX_MEASUREMENTS));
  const shot = scrub({ ...full, measurements: m.filter((_, i) => i % stride === 0) });
  // A workflow's `name` concatenates roaster, bean and profile title. It is not
  // covered by FIELD_LABELS — `name` is excluded there so profile STEP names
  // survive — so rebuild it from the already-scrubbed parts rather than letting
  // the real one through.
  if (shot.workflow?.name) {
    shot.workflow.name = [
      shot.workflow.context?.coffeeRoaster,
      shot.workflow.context?.coffeeName,
      shot.workflow.profile?.title,
    ].filter(Boolean).join(" · ");
  }
  fullShots.push(shot);
}

const header = `// Seed data for the mock gateway. Mutated in-process by the mock's write
// endpoints so a dev session behaves like a real one (create a recipe, hide a
// profile, rate a shot — it all sticks until the server restarts).
//
// GENERATED by scripts/snapshot-fixtures.mjs from a real gateway — do not edit
// the entity data by hand, regenerate instead, or it drifts from the API again.
// Coffee-identifying text is replaced with placeholders (this repo is public);
// field names, types, empty strings and timestamps are verbatim.
//
// Snapshot taken: ${new Date().toISOString().slice(0, 10)}
`;

const footer = `
// Shot timestamps are rewritten on load so the history list always looks
// recent, however old this snapshot is. Everything else is verbatim.
const MINUTES_AGO = [20, 90, 300];
shotsFull.forEach((s, i) => {
  s.timestamp = new Date(Date.now() - (MINUTES_AGO[i] ?? (i + 1) * 60) * 60_000).toISOString();
});

// The list endpoint omits measurements — mirror that here rather than letting
// the mock hand out fuller shots than the gateway ever does.
export const shots = shotsFull.map(({ measurements, ...rest }) => rest);
export const shotDetails = Object.fromEntries(shotsFull.map((s) => [s.id, s]));

// Not exposed over REST by the gateway (WebSocket only), so still hand-written.
export const waterLevels = { currentLevel: 780, refillLevel: 100 };
export const deletedProfiles = [];

// HAND-WRITTEN, deliberately not snapshotted: the KV store holds the skin's own
// settings and the user's recipes, and this repo is public. Its shape is ours
// to choose anyway — unlike the gateway entities above.
export const store = {
  NSX: {
    recipes: [
      {
        id: "recipe-mock-1",
        lastUsed: Date.now() - 60_000,
        coffeeRoaster: "Roaster 1",
        coffeeName: "Bean 1",
        grinderModel: "Grinder 1",
        grinderSetting: "18",
        profileTitle: "Profile 1",
        selectedProfileId: profiles[0]?.id,
        targetDoseWeight: 18,
        targetYield: 36,
        groupTemp: 93,
      },
      {
        id: "recipe-mock-2",
        lastUsed: Date.now() - 3_600_000,
        coffeeRoaster: "Roaster 1",
        coffeeName: "Bean 2",
        grinderModel: "Grinder 1",
        grinderSetting: "3.2",
        profileTitle: "Profile 2",
        selectedProfileId: profiles[1]?.id,
        targetDoseWeight: 20,
        targetYield: 50,
        groupTemp: 90,
      },
    ],
    "ui-settings": {},
  },
  skin: { theme: "dark", lang: "de" },
};

export const currentWorkflow = {
  profile: profiles[0]?.profile,
  profileId: profiles[0]?.id,
  context: store.NSX.recipes[0],
};
`;

const body = [
  header,
  section("machineInfo", machineInfo),
  section("machineState", machineState),
  section("beans", beans),
  section("beanBatches", beanBatches),
  section("grinders", grinders),
  section("profiles", profiles),
  section("shotsFull", fullShots, "// Full shots, as GET /api/v1/shots/{id} returns them."),
  footer,
].join("\n");

writeFileSync(OUT, body, "utf8");

console.log(`Wrote ${OUT}`);
console.log(`  gateway     ${GATEWAY}`);
console.log(`  beans       ${beans.length} (of ${beansAll.length})`);
console.log(`  grinders    ${grinders.length}`);
console.log(`  profiles    ${profiles.length}`);
console.log(`  shots       ${fullShots.length}, ${fullShots[0]?.measurements?.length ?? 0} measurements each`);
console.log(`  NOT taken   store (skin settings + recipes — repo is public)`);
