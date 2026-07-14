#!/usr/bin/env node
/**
 * RETIRED 2026-07-04: this script edits the legacy logbook.csv, which was
 * folded into logbook.d/ (migrate-csv-to-shards.mjs) and renamed to
 * logbook.csv.migrated-2026-07-04.bak — so it now exits with "logbook not
 * found", by design. To retro-correct sessions today, use bulk-regen.mjs /
 * regen-session.mjs: they recompute from transcripts and overwrite the
 * session's shard in place.
 *
 * reconcile-logbook.mjs — retroactively correct existing logbook rows whose
 * transcripts are still on disk.
 *
 * Why this exists: until the subagent-aware UsageCalculator landed, sessions
 * that delegated to Task/Agent or workflow subagents were billed on the main
 * transcript ALONE — every subagent's tokens (written to sibling
 * `<projectDir>/<session-id>/subagents/agent-*.jsonl` files) were dropped. The
 * worst case observed undercounted a session by ~50%. This script re-runs the
 * current calculator over every logbook row, recomputing from the real
 * transcripts (main + subagents, both layouts), and rewrites only the seven
 * usage columns of rows that changed. Everything else — timestamps, location,
 * slug, machine — is preserved byte-for-byte.
 *
 * It only touches rows whose main transcript still exists locally. Rows whose
 * JSONL has been rotated away (e.g. recorded on a different machine) are left
 * exactly as they are; run the script on that machine to fix those.
 *
 * Prereq: `npm run build` (this imports the compiled calculator from dist/).
 *
 * Usage:
 *   node scripts/reconcile-logbook.mjs                 # dry run — prints proposed changes
 *   node scripts/reconcile-logbook.mjs --apply         # writes, after a timestamped .bak
 *   node scripts/reconcile-logbook.mjs --logbook="D:/path/logbook.csv"   # override path
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
  copyFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const home = process.env.USERPROFILE || process.env.HOME || "";

// Logbook column indices (see logbook-writer.ts HEADER).
const COL = { sessionId: 2, machine: 6, input: 12, output: 13, cacheC: 14, cacheR: 15, total: 16, cost: 17, models: 18 };

/**
 * The canonical Drive logbook this repo's author writes to (via the config
 * `dataRoot`). Pass --logbook=<path> to point at a different data root.
 */
function defaultLogbook() {
  if (existsSync("H:/My Drive")) return "H:/My Drive/agent-usage-stat/logbook.csv";
  return join(home, ".agent-usage-stat", "projects", "logbook.csv");
}
const logArg = args.find((a) => a.startsWith("--logbook="));
const LOG = logArg ? logArg.slice("--logbook=".length) : defaultLogbook();
const projectsRoot = join(home, ".claude", "projects");

// --- load the compiled, subagent-aware calculator -------------------------
const calcPath = join(repoRoot, "dist", "providers", "claude", "usage-calculator.js");
if (!existsSync(calcPath)) {
  console.error(`dist not built: ${calcPath}\nRun \`npm run build\` first.`);
  process.exit(1);
}
const { UsageCalculator } = await import(pathToFileURL(calcPath).href);

if (!existsSync(LOG)) {
  console.error(`logbook not found: ${LOG}\nPass --logbook="<path>" if it's mounted elsewhere.`);
  process.exit(1);
}
if (!existsSync(projectsRoot)) {
  console.error(`transcripts dir not found: ${projectsRoot}`);
  process.exit(1);
}

// --- CSV helpers (RFC 4180, single-line rows) ------------------------------
function parseCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') q = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
const esc = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const projectDirs = readdirSync(projectsRoot);
/** Largest <projectDir>/<sid>.jsonl across all project dirs, or null. */
function findMainTranscript(sid) {
  let best = null, bestSize = -1;
  for (const d of projectDirs) {
    const p = join(projectsRoot, d, `${sid}.jsonl`);
    if (existsSync(p)) {
      const s = statSync(p).size;
      if (s > bestSize) { bestSize = s; best = p; }
    }
  }
  return best;
}
function hasSubagents(sid) {
  return projectDirs.some((d) => existsSync(join(projectsRoot, d, sid, "subagents")));
}

// --- reconcile -------------------------------------------------------------
const raw = readFileSync(LOG, "utf-8");
const lines = raw.split("\n");
const calc = new UsageCalculator();
const out = [lines[0]]; // header preserved verbatim
const changed = [];
let unchanged = 0, gone = 0, blank = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) { blank++; out.push(line); continue; }
  const f = parseCsvLine(line);
  const sid = f[COL.sessionId];
  const main = sid ? findMainTranscript(sid) : null;
  if (!main) { gone++; out.push(line); continue; }

  const r = await calc.calculate(main, sid);
  const newCost = r.totalCost.toFixed(6);
  const newTot = String(r.totalTokens);
  if (f[COL.cost] === newCost && f[COL.total] === newTot) { unchanged++; out.push(line); continue; }

  const g = [...f];
  g[COL.input] = String(r.inputTokens);
  g[COL.output] = String(r.outputTokens);
  g[COL.cacheC] = String(r.cacheCreationTokens);
  g[COL.cacheR] = String(r.cacheReadTokens);
  g[COL.total] = newTot;
  g[COL.cost] = newCost;
  g[COL.models] = r.modelsUsed.join(";");
  out.push(g.map(esc).join(","));
  changed.push({
    sid: sid.slice(0, 8), project: f[3], end: f[0].slice(0, 10),
    machine: f[COL.machine], oldCost: +f[COL.cost], newCost: +newCost,
    subagents: hasSubagents(sid),
  });
}

// --- report ----------------------------------------------------------------
console.log(`logbook:     ${LOG}`);
console.log(`transcripts: ${projectsRoot}`);
console.log(`rows: changed=${changed.length} unchanged=${unchanged} transcript-gone=${gone} blank=${blank}\n`);

if (changed.length) {
  changed.sort((a, b) => b.newCost - b.oldCost - (a.newCost - a.oldCost));
  console.log("  sid       project                       end         old$      new$       Δ$   reason");
  let oldSum = 0, newSum = 0;
  for (const c of changed) {
    oldSum += c.oldCost; newSum += c.newCost;
    const d = c.newCost - c.oldCost;
    console.log(
      `  ${c.sid}  ${c.project.padEnd(28).slice(0, 28)}  ${c.end}  ${c.oldCost.toFixed(2).padStart(8)}  ${c.newCost.toFixed(2).padStart(8)}  ${(d >= 0 ? "+" : "") + d.toFixed(2).padStart(6)}   ${c.subagents ? "subagents" : "other"}`,
    );
  }
  console.log(`\n  total: $${oldSum.toFixed(2)} -> $${newSum.toFixed(2)}  (Δ +$${(newSum - oldSum).toFixed(2)})`);
}

if (APPLY && changed.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = LOG.replace(/\.csv$/, `.bak-${stamp}.csv`);
  copyFileSync(LOG, bak);
  writeFileSync(LOG, out.join("\n"), "utf-8");
  console.log(`\nAPPLIED. backup: ${bak}`);
} else if (changed.length) {
  console.log(`\n(dry run — re-run with --apply to write; a timestamped .bak is made first)`);
} else {
  console.log("nothing to change.");
}
