/* ============================================================
   claude-receipts portal — data builder
   Merges the session logbook into the clean artifacts the portal loads:
     public/data/sessions.json  — one normalized record per session
     public/data/meta.json      — build time + headline counts (freshness pill)

   Two sources, merged by session_id (shard wins on a tie):
     1. logbook.d/<id>.json   — one JSON file per session (current mechanism)
     2. logbook.csv           — legacy single append-only file (historical rows)

   Per-session shards exist because appending to one shared logbook.csv on
   Google Drive File Stream silently dropped rows (last-writer-wins on the whole
   file). Unique-named shards never conflict. The CSV is kept read-only for the
   history written before the switch.

   Source path resolution (first hit wins) — points at the CSV; the shard dir is
   its sibling logbook.d/:
     1. argv[2]
     2. $CLAUDE_RECEIPTS_LOGBOOK
     3. H:\My Drive\claude-receipts\logbook.csv   (the canonical Drive copy)

   If neither source is reachable, the existing snapshot in public/data is left
   untouched so the portal still builds offline.
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
const DEFAULT_SRC = "H:/My Drive/claude-receipts/logbook.csv";

const src = process.argv[2] || process.env.CLAUDE_RECEIPTS_LOGBOOK || DEFAULT_SRC;
const SHARD_DIR = resolve(dirname(src), "logbook.d");

// ---- RFC-4180-ish CSV line parser (honors quotes + escaped "") ----
function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

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
  };
}

function main() {
  const haveCsv = existsSync(src);
  const haveShards = existsSync(SHARD_DIR);

  if (!haveCsv && !haveShards) {
    console.warn(`[build-data] no source: ${src} (and no ${SHARD_DIR})`);
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

  // Merge by session_id; shards (current mechanism) override CSV (history).
  // Sessions without an id can't be de-duped, so keep them all.
  const bySid = new Map();
  const noId = [];
  const add = (rec) => {
    const s = toSession(rec);
    if (!s) return;
    if (s.sid) bySid.set(s.sid, s);
    else noId.push(s);
  };

  let csvCount = 0, shardCount = 0, badShards = 0;

  // 1) legacy CSV (added first so shards win on collision)
  if (haveCsv) {
    const lines = readFileSync(src, "utf8").split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length) {
      const header = parseLine(lines[0]).map((h) => h.trim());
      const need = ["start_time", "total_cost_usd", "total_tokens", "project"];
      for (const k of need) {
        if (!header.includes(k)) { console.error(`[build-data] missing column: ${k}`); process.exit(1); }
      }
      for (let li = 1; li < lines.length; li++) {
        const r = parseLine(lines[li]);
        if (r.length < header.length) continue; // skip malformed/truncated rows
        const rec = {};
        header.forEach((h, i) => { rec[h] = r[i]; });
        add(rec);
        csvCount++;
      }
    }
  }

  // 2) per-session JSON shards (override)
  if (haveShards) {
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
    source: src,
    shardDir: haveShards ? SHARD_DIR : null,
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
    `[build-data] ${sessions.length} sessions (${csvCount} csv + ${shardCount} shards` +
      `${badShards ? `, ${badShards} bad` : ""}) · ${projects.size} projects · ` +
      `$${meta.totalCost.toLocaleString("en-US")} → public/data/`,
  );
}

main();
