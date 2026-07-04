#!/usr/bin/env node
/**
 * health-check.mjs — integrity guard for the receipts data pipeline.
 *
 * The logbook is one directory of per-session JSON shards (logbook.d/, see
 * migrate-csv-to-shards.mjs) that every consumer sums directly. This script
 * checks the invariants that keep those numbers trustworthy and exits 1 if
 * any RED finding fires, so it can run headless (cron / on demand) and fail
 * loudly instead of letting the dashboard drift quietly.
 *
 * Checks:
 *   RED  unparseable shards
 *   RED  a live logbook.csv reappeared next to logbook.d/ (a machine is
 *        running a pre-2026-06-29 clone — its rows are being IGNORED)
 *   RED  local-fallback shards exist (~/.claude-receipts/projects/logbook.d)
 *        — written while Drive was unmounted; invisible to portal/statusline
 *        until moved to the Drive dir
 *   RED  pricing misses in hook.log in the last 7 days (models billing $0 NOW)
 *   YEL  zero-cost shards with nonzero tokens (pricing-miss residue; regen if
 *        the transcript still exists)
 *   YEL  shard models missing from src/core/pricing.ts (after normalization)
 *   YEL  receipts on Drive with no shard, beyond the known-lost baseline
 *   YEL  a machine that used to write shards has gone quiet > 14 days
 *   YEL  token-column arithmetic mismatches
 *
 * Usage: node scripts/health-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const ROOT = existsSync("H:/My Drive")
  ? "H:/My Drive/claude-receipts"
  : join(HOME, ".claude-receipts", "projects");
const DIR = join(ROOT, "logbook.d");
const LOCAL_DIR = join(HOME, ".claude-receipts", "projects", "logbook.d");
const HOOK_LOG = join(HOME, ".claude-receipts", "hook.log");

// Sessions known lost before the shard mechanism existed (receipts rendered
// $0 in pricing-miss windows, transcripts since rotated). Permanent; only NEW
// orphans beyond these are actionable.
const KNOWN_LOST = new Set([
  "e9f4c7b9", "e3de7618", "df717342", "c810e36d", "4983b333", "31528023",
  "1bdf8e19", "5900ef63", "7a831e8d", "8e54e2ed", "cd011e81",
]);

let red = 0, yellow = 0;
const fail = (msg) => { red++; console.log("RED  " + msg); };
const warn = (msg) => { yellow++; console.log("YEL  " + msg); };
const ok = (msg) => console.log("ok   " + msg);

if (!existsSync(DIR)) {
  fail(`shard dir missing: ${DIR}`);
  process.exit(1);
}

// ---- load shards ----
const shards = [];
for (const f of readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith(".json")) continue;
  try { shards.push(JSON.parse(readFileSync(join(DIR, f), "utf8"))); }
  catch (e) { fail(`unparseable shard ${f}: ${e.message}`); }
}
ok(`${shards.length} shards parsed`);

// ---- resurrected CSV ----
if (existsSync(join(ROOT, "logbook.csv"))) {
  fail("logbook.csv reappeared — some machine runs a pre-shard clone; its sessions are being DROPPED. Update that clone (git pull + npm run build), then re-run migrate-csv-to-shards.mjs.");
} else ok("no legacy logbook.csv");

// ---- forked local shards ----
if (LOCAL_DIR !== DIR && existsSync(LOCAL_DIR)) {
  const n = readdirSync(LOCAL_DIR).filter((f) => f.endsWith(".json")).length;
  if (n) fail(`${n} shard(s) in local fallback ${LOCAL_DIR} — written while Drive was unmounted; move them to ${DIR}`);
  else ok("local fallback dir empty");
} else ok("no local fallback fork");

// ---- recent pricing misses ----
// A miss whose model has SINCE been added to the table (and dist rebuilt) is
// downgraded: the leak is plugged, only the already-written session may need a
// regen. Only a model still absent from the table bills $0 on the next session.
if (existsSync(HOOK_LOG)) {
  const cutoff = Date.now() - 7 * 86400000;
  const recent = readFileSync(HOOK_LOG, "utf8").split(/\r?\n/).filter((l) => {
    const m = l.match(/^\[([0-9T:.\-]+Z)\]\s+pricing miss/);
    return m && Date.parse(m[1]) >= cutoff && !l.includes("<synthetic>");
  });
  let tableNow = new Set();
  try {
    const distPricing = readFileSync(new URL("../dist/core/pricing.js", import.meta.url), "utf8");
    tableNow = new Set([...distPricing.matchAll(/"(claude-[^"]+)":\s*\{/g)].map((m) => m[1]));
  } catch { /* dist not built — treat all misses as live */ }
  const live = recent.filter((l) => {
    const m = l.match(/models=([^\s]+)/);
    return !(m && tableNow.has(m[1]));
  });
  if (live.length) fail(`${live.length} UNRESOLVED pricing miss(es) in the last 7 days — add the model to src/core/pricing.ts, run npm run build, regen the sessions:\n     ` + live.slice(-3).join("\n     "));
  else if (recent.length) warn(`${recent.length} pricing miss(es) in the last 7 days, model since added to the table — verify the affected session(s) were regenerated`);
  else ok("no pricing misses in last 7 days");
} else warn(`hook.log not found at ${HOOK_LOG}`);

// ---- zero-cost shards with tokens ----
// Baseline: two 2026-04-23 opus-4-7 sessions priced $0 in a pricing-miss
// window; transcripts long gone, ~$2.40 combined (estimated from their own
// token columns). Permanent — anything beyond these is new residue.
const KNOWN_ZERO = new Set(["a615a2cf", "e5f5e2c9"]);
const zc = shards.filter((s) =>
  (s.total_tokens || 0) > 0 && !(s.total_cost_usd > 0) && !KNOWN_ZERO.has(String(s.session_id).slice(0, 8)));
if (zc.length) {
  for (const s of zc) warn(`zero-cost shard ${String(s.session_id).slice(0, 8)} (${String(s.end_time).slice(0, 10)}, ${s.total_tokens} tok, ${JSON.stringify(s.models)}) — regen if transcript exists`);
} else ok("no new zero-cost shards with tokens");

// ---- models vs pricing table ----
try {
  const pricingSrc = readFileSync(new URL("../src/core/pricing.ts", import.meta.url), "utf8");
  const known = new Set([...pricingSrc.matchAll(/"(claude-[^"]+)":\s*\{/g)].map((m) => m[1]));
  const norm = (m) => m.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  const unk = new Set();
  for (const s of shards) {
    const models = Array.isArray(s.models) ? s.models : String(s.models || "").split(/[;,]/);
    for (const m of models.map((x) => String(x).trim()).filter(Boolean)) {
      if (!known.has(norm(m))) unk.add(norm(m));
    }
  }
  unk.size ? warn(`models not in pricing table: ${[...unk].join(", ")}`) : ok("all shard models priced");
} catch { warn("could not read src/core/pricing.ts (run from repo root)"); }

// ---- orphan receipts ----
const prefixes = new Set(shards.map((s) => String(s.session_id).slice(0, 8)));
const orphans = [];
for (const f of readdirSync(ROOT)) {
  const m = f.match(/^([0-9a-f]{8})-\d{8}-\d{6}\.html$/);
  if (m && !prefixes.has(m[1]) && !KNOWN_LOST.has(m[1])) orphans.push(f);
}
orphans.length
  ? warn(`${orphans.length} NEW receipt(s) with no shard (lost row or hook failure): ${orphans.join(", ")}`)
  : ok("no new orphan receipts");

// ---- machine recency ----
const lastByMachine = {};
for (const s of shards) {
  const d = String(s.end_time || "").slice(0, 10);
  const m = s.machine || "?";
  if (!lastByMachine[m] || d > lastByMachine[m]) lastByMachine[m] = d;
}
for (const [m, d] of Object.entries(lastByMachine)) {
  const age = Math.floor((Date.now() - Date.parse(d)) / 86400000);
  age > 14
    ? warn(`machine ${m}: no shards for ${age} days (last ${d}) — unused, or its clone/hook is broken`)
    : ok(`machine ${m}: last shard ${d}`);
}

// ---- token arithmetic ----
const bad = shards.filter((s) =>
  (s.input_tokens||0)+(s.output_tokens||0)+(s.cache_creation_tokens||0)+(s.cache_read_tokens||0) !== (s.total_tokens||0));
bad.length ? warn(`${bad.length} shard(s) with token-column arithmetic mismatch`) : ok("token columns consistent");

console.log(`\n${red} red, ${yellow} yellow across ${shards.length} shards`);
process.exit(red ? 1 : 0);
