#!/usr/bin/env node
/**
 * One-shot migration of the frozen, Claude-only legacy logbook.csv into
 * canonical per-session shards. Dry-run is the default. Existing shards are
 * never overwritten automatically.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  renameSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  resolveUsageRootFromDisk,
  usageRootCandidatesFromDisk,
} from "../dist/utils/usage-root.js";

const EXPECTED_HEADER = [
  "timestamp",
  "session_slug",
  "session_id",
  "project",
  "branch",
  "cwd",
  "machine",
  "location",
  "start_time",
  "end_time",
  "duration_seconds",
  "duration_human",
  "input_tokens",
  "output_tokens",
  "cache_creation_tokens",
  "cache_read_tokens",
  "total_tokens",
  "total_cost_usd",
  "models",
];
const NUMERIC_FIELDS = [
  "duration_seconds",
  "input_tokens",
  "output_tokens",
  "cache_creation_tokens",
  "cache_read_tokens",
  "total_tokens",
  "total_cost_usd",
];

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const csvArg = args.find((arg) => arg.startsWith("--csv="));
const rootArg = args.find((arg) => arg.startsWith("--root="));
const CSV = selectCsvPath(csvArg, rootArg);

if (!CSV) {
  console.log("nothing to migrate: no logbook.csv found in any configured, current, transitional, or legacy root");
  process.exit(0);
}
if (!existsSync(CSV)) {
  console.log(`nothing to migrate: ${CSV} not found`);
  process.exit(0);
}

const SHARD_DIR = resolve(dirname(CSV), "logbook.d");
console.log(`source CSV: ${CSV}`);
console.log(`target shards: ${SHARD_DIR}`);

function selectCsvPath(explicitCsv, explicitRoot) {
  if (explicitCsv) return resolve(explicitCsv.slice("--csv=".length));
  if (explicitRoot) return resolve(explicitRoot.slice("--root=".length), "logbook.csv");

  // Broad discovery is intentional here. This one-shot tool must locate
  // pre-v2 CSVs that can live outside the current runtime data root.
  const roots = [
    resolveUsageRootFromDisk().root,
    ...usageRootCandidatesFromDisk().map((candidate) => candidate.root),
  ];
  const seen = new Set();
  const matches = [];
  for (const root of roots) {
    const path = resolve(root, "logbook.csv");
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    if (existsSync(path)) matches.push(path);
  }

  if (matches.length > 1) {
    console.error(
      "multiple legacy CSV files found; pass --csv=<path> or --root=<path> explicitly:\n  " +
      matches.join("\n  "),
    );
    process.exit(1);
  }
  return matches[0] || null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const finishField = () => {
    row.push(field);
    field = "";
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) throw new Error("unexpected quote in unquoted field");
      quoted = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\n") {
      finishRow();
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) throw new Error("unterminated quoted field");
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

function requireExactHeader(header) {
  if (
    header.length !== EXPECTED_HEADER.length ||
    header.some((name, index) => name.trim() !== EXPECTED_HEADER[index])
  ) {
    throw new Error(
      "unsupported CSV schema; expected exactly:\n  " +
      EXPECTED_HEADER.join(","),
    );
  }
}

function requireNumber(record, field, lineNumber) {
  const raw = record[field];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`line ${lineNumber}: ${field} is required`);
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`line ${lineNumber}: ${field} must be a finite nonnegative number`);
  }
  return value;
}

function requireTimestamp(value, field, lineNumber) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error(`line ${lineNumber}: ${field} must be a valid timestamp`);
  }
  return value;
}

function shardName(shard) {
  const base = shard.session_id || `${shard.session_slug || "session"}-${shard.end_time}`;
  return `${base.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
}

function buildShard(record, lineNumber) {
  const numbers = Object.fromEntries(
    NUMERIC_FIELDS.map((field) => [field, requireNumber(record, field, lineNumber)]),
  );

  // The legacy CSV predates Codex support and contains Claude sessions only.
  return {
    provider: "claude",
    timestamp: record.timestamp || "",
    session_slug: record.session_slug || "",
    session_id: record.session_id || "",
    project: record.project || "",
    branch: record.branch || "",
    cwd: record.cwd || "",
    machine: record.machine || "",
    location: record.location || "",
    start_time: requireTimestamp(record.start_time, "start_time", lineNumber),
    end_time: requireTimestamp(record.end_time, "end_time", lineNumber),
    duration_seconds: numbers.duration_seconds,
    duration_human: record.duration_human || "",
    input_tokens: numbers.input_tokens,
    output_tokens: numbers.output_tokens,
    cache_creation_tokens: numbers.cache_creation_tokens,
    cache_read_tokens: numbers.cache_read_tokens,
    total_tokens: numbers.total_tokens,
    total_cost_usd: numbers.total_cost_usd,
    models: String(record.models || "").split(/[;,]/).map((model) => model.trim()).filter(Boolean),
  };
}

function isValidShard(path) {
  try {
    const shard = JSON.parse(readFileSync(path, "utf8"));
    const timestamp = Date.parse(shard.end_time || shard.start_time || "");
    return (
      shard &&
      typeof shard === "object" &&
      !Array.isArray(shard) &&
      Number.isFinite(timestamp) &&
      typeof shard.total_tokens === "number" &&
      Number.isFinite(shard.total_tokens) &&
      shard.total_tokens >= 0 &&
      typeof shard.total_cost_usd === "number" &&
      Number.isFinite(shard.total_cost_usd) &&
      shard.total_cost_usd >= 0
    );
  } catch {
    return false;
  }
}

function writeShardAtomically(path, shard, index) {
  const temporary = `${path}.tmp-${process.pid}-${index}`;
  try {
    writeFileSync(temporary, JSON.stringify(shard, null, 2), "utf8");
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function uniqueBackupPath(csvPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let counter = 0; counter < 1000; counter++) {
    const suffix = counter ? `-${counter}` : "";
    const candidate = csvPath.replace(/\.csv$/, `.csv.migrated-${timestamp}-${process.pid}${suffix}.bak`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("could not reserve a unique CSV backup path");
}

let rows;
try {
  rows = parseCsv(readFileSync(CSV, "utf8"));
  if (!rows.length) throw new Error("CSV is empty");
  requireExactHeader(rows[0]);
} catch (error) {
  console.error(`refusing migration: ${error.message}`);
  process.exit(1);
}

const header = rows[0].map((name) => name.trim());
const validExisting = new Set();
const invalidExisting = new Set();
if (existsSync(SHARD_DIR)) {
  for (const file of readdirSync(SHARD_DIR).filter((name) => name.toLowerCase().endsWith(".json"))) {
    (isValidShard(join(SHARD_DIR, file)) ? validExisting : invalidExisting).add(file);
  }
}

if (invalidExisting.size) {
  console.error(
    `refusing migration: ${invalidExisting.size} invalid existing shard(s) require explicit reconciliation before CSV retirement:\n  ` +
    [...invalidExisting].join("\n  "),
  );
  process.exit(1);
}

const candidates = new Map();
const errors = [];
let noId = 0;
for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
  const lineNumber = rowIndex + 1;
  const row = rows[rowIndex];
  if (row.length !== header.length) {
    errors.push(`line ${lineNumber}: expected ${header.length} fields, found ${row.length}`);
    continue;
  }

  const record = Object.fromEntries(header.map((name, index) => [name, row[index]]));
  try {
    const shard = buildShard(record, lineNumber);
    if (!shard.session_id) noId++;
    const name = shardName(shard);
    const prior = candidates.get(name);
    if (prior) {
      errors.push(
        `line ${lineNumber}: output collision with line ${prior.lineNumber} at ${name}`,
      );
      continue;
    }
    candidates.set(name, { name, shard, lineNumber });
  } catch (error) {
    errors.push(error.message);
  }
}

if (errors.length) {
  console.error(
    `refusing migration: ${errors.length} CSV validation error(s):\n  ` +
    errors.join("\n  "),
  );
  process.exit(1);
}

const pendingWrites = [];
let skippedShardWins = 0;
for (const candidate of candidates.values()) {
  if (validExisting.has(candidate.name)) {
    skippedShardWins++;
    console.log(
      `  shard wins over CSV row: ${candidate.name} ` +
      `(csv $${candidate.shard.total_cost_usd.toFixed(2)})`,
    );
  } else {
    pendingWrites.push(candidate);
  }
}

console.log(
  `\n${APPLY ? "APPLY" : "DRY RUN"}: ${pendingWrites.length} rows -> shards, ` +
  `${skippedShardWins} superseded by valid existing shards, ${noId} without session_id`,
);

if (APPLY) {
  const backup = uniqueBackupPath(CSV);
  mkdirSync(SHARD_DIR, { recursive: true });
  pendingWrites.forEach(({ name, shard }, index) =>
    writeShardAtomically(join(SHARD_DIR, name), shard, index));

  renameSync(CSV, backup);
  console.log(`CSV retired -> ${backup}`);

  let total = 0, count = 0;
  for (const file of readdirSync(SHARD_DIR)) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const shard = JSON.parse(readFileSync(join(SHARD_DIR, file), "utf8"));
    total += Number(shard.total_cost_usd) || 0;
    count++;
  }
  console.log(`verify: ${count} shards, lifetime total $${total.toFixed(2)}`);
}
