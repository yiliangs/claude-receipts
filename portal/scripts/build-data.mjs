/* ============================================================
   claude-receipts portal — data builder
   Normalizes the session logbook into the clean artifacts the portal loads:
     public/data/sessions.json  — one normalized record per session
     public/data/meta.json      — build time + headline counts (freshness pill)

   SINGLE source of truth: logbook.d/<session_id>.json — one JSON file per
   session, filename keyed by session id, so a session structurally cannot
   exist twice. Every consumer (this builder, the terminal statusline) does a
   plain sum over the same directory — no merge rules to drift apart.

   History: sessions used to append to one shared logbook.csv, but Google
   Drive File Stream resolved concurrent writes last-writer-wins and silently
   dropped rows — hence per-session shards. The CSV era rows were folded into
   logbook.d/ on 2026-07-04 (scripts/migrate-csv-to-shards.mjs) and the CSV
   retired to logbook.csv.migrated-2026-07-04.bak. A live logbook.csv found
   next to the shard dir is IGNORED with a loud warning: two sources is the
   exact design this migration removed.

   Source resolution (first hit wins):
     1. argv[2]                    — a receipts-root dir, or (legacy) a path
     2. $CLAUDE_RECEIPTS_LOGBOOK     to logbook.csv whose parent anchors it
     3. the package's canonical resolver (dist/utils/receipts-root.js):
        config receiptsRoot → auto-detected Google Drive mount → local default
   The resolver import requires the package built at the repo root
   (npm run build); without it and without an override, the portal keeps
   whatever snapshot is already in public/data.

   If the shard dir is unreachable, the existing snapshot in public/data is
   left untouched so the portal still builds offline.
   ============================================================ */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/data");

function overrideRoot() {
  const given = process.argv[2] || process.env.CLAUDE_RECEIPTS_LOGBOOK;
  if (!given) return null;
  return given.toLowerCase().endsWith(".csv")
    ? dirname(resolve(given))
    : resolve(given);
}

async function canonicalRoot() {
  try {
    const { resolveReceiptsRootFromDisk } = await import(
      "../../dist/utils/receipts-root.js"
    );
    return resolveReceiptsRootFromDisk().root;
  } catch {
    console.warn(
      "[build-data] cannot load dist/utils/receipts-root.js — run `npm run build` at the repo root, or pass a root via argv/$CLAUDE_RECEIPTS_LOGBOOK.",
    );
    return null;
  }
}

const ROOT = overrideRoot() ?? (await canonicalRoot());
const SHARD_DIR = ROOT ? resolve(ROOT, "logbook.d") : null;

const num = (v) => {
  const n = Number(typeof v === "string" ? v.trim() : v);
  return Number.isFinite(n) ? n : 0;
};
// models column packs several model ids with ';' (occasionally ',') separators
const splitModels = (v) =>
  String(v || "")
    .split(/[;,]/)
    .map((m) => m.trim())
    .filter(Boolean);

// Normalize one column-named record (from a CSV row or a JSON shard) into the
// shape the portal expects. Returns null for rows without a usable start_time.
function toSession(rec) {
  const start = rec.start_time;
  if (!start || Number.isNaN(Date.parse(start))) return null;
  const models = Array.isArray(rec.models)
    ? rec.models.map((m) => String(m).trim()).filter(Boolean)
    : splitModels(rec.models);
  return {
    slug: rec.session_slug || String(rec.session_id || "").slice(0, 8) || "—",
    sid: String(rec.session_id || ""),
    project: String(rec.project || "—").trim(),
    branch: String(rec.branch || "").trim(),
    cwd: rec.cwd || "",
    machine: String(rec.machine || "—").trim(),
    location: String(rec.location || "").trim(),
    start,
    end: rec.end_time || null,
    durSec: num(rec.duration_seconds),
    durHuman: rec.duration_human || "",
    input: num(rec.input_tokens),
    output: num(rec.output_tokens),
    cacheCreate: num(rec.cache_creation_tokens),
    cacheRead: num(rec.cache_read_tokens),
    totalTokens: num(rec.total_tokens),
    cost: num(rec.total_cost_usd),
    models,
    // Shards written before 2026-07-09 predate the provider field.
    provider: String(rec.provider || "claude"),
  };
}

function main() {
  const legacyCsv = ROOT ? resolve(ROOT, "logbook.csv") : null;
  if (legacyCsv && existsSync(legacyCsv)) {
    console.warn(
      `[build-data] WARNING: legacy ${legacyCsv} exists but is IGNORED — logbook.d/ is the single ` +
        `source of truth (migrated 2026-07-04). Fold it in with scripts/migrate-csv-to-shards.mjs.`,
    );
  }

  if (!SHARD_DIR || !existsSync(SHARD_DIR)) {
    console.warn(`[build-data] no source: ${SHARD_DIR ?? "(unresolved receipts root)"}`);
    if (existsSync(resolve(OUT_DIR, "sessions.json"))) {
      console.warn("[build-data] keeping existing snapshot in public/data — portal will still build.");
    } else {
      console.error("[build-data] no source and no snapshot — portal will have no data.");
    }
    // The launcher sets CLAUDE_RECEIPTS_REQUIRE_SOURCE so a disconnected Drive
    // surfaces as a non-zero exit (loud warning) instead of silently serving a
    // stale snapshot. Offline `npm run build` leaves it unset → stays exit-0.
    process.exit(process.env.CLAUDE_RECEIPTS_REQUIRE_SOURCE ? 1 : 0);
  }

  // Filename = session_id, so the directory itself guarantees one record per
  // session; sessions without an id (writer fallback names) are kept as-is.
  const bySid = new Map();
  const noId = [];
  const add = (rec) => {
    const s = toSession(rec);
    if (!s) return;
    if (s.sid) bySid.set(s.sid, s);
    else noId.push(s);
  };

  let shardCount = 0, badShards = 0;
  for (const f of readdirSync(SHARD_DIR)) {
    if (!f.toLowerCase().endsWith(".json")) continue;
    try {
      add(JSON.parse(readFileSync(resolve(SHARD_DIR, f), "utf8")));
      shardCount++;
    } catch (e) {
      badShards++;
      console.warn(`[build-data] skipping bad shard ${f}: ${e.message}`);
    }
  }

  const sessions = [...bySid.values(), ...noId].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
  if (!sessions.length) { console.error("[build-data] no usable sessions"); process.exit(1); }

  // ---- meta / headline counts ----
  let minStart = Infinity, maxStart = -Infinity, totalCost = 0;
  const projects = new Set(), machines = new Set();
  for (const s of sessions) {
    const t = Date.parse(s.start);
    if (t < minStart) minStart = t;
    if (t > maxStart) maxStart = t;
    totalCost += s.cost;
    projects.add(s.project);
    machines.add(s.machine);
  }
  const meta = {
    generatedAt: new Date().toISOString(),
    source: ROOT,
    shardDir: SHARD_DIR,
    sessions: sessions.length,
    projects: projects.size,
    machines: machines.size,
    totalCost: Math.round(totalCost * 100) / 100,
    span: {
      from: Number.isFinite(minStart) ? new Date(minStart).toISOString() : null,
      to: Number.isFinite(maxStart) ? new Date(maxStart).toISOString() : null,
    },
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "sessions.json"), JSON.stringify(sessions));
  writeFileSync(resolve(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(
    `[build-data] ${sessions.length} sessions (${shardCount} shards` +
      `${badShards ? `, ${badShards} bad` : ""}) · ${projects.size} projects · ` +
      `$${meta.totalCost.toLocaleString("en-US")} → public/data/`,
  );
}

main();
