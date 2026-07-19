#!/usr/bin/env node
/** Integrity guard for the usage-data pipeline. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  resolveUsageRootFromDisk,
  shardDirectory,
  usageRootCandidatesFromDisk,
} from "../dist/utils/usage-root.js";
import { priceFor as claudePriceFor } from "../dist/providers/claude/pricing.js";
import { priceFor as codexPriceFor } from "../dist/providers/codex/pricing.js";

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const ROOT = resolveUsageRootFromDisk().root;
const DIR = shardDirectory(ROOT);
const HOOK_LOGS = [
  join(HOME, ".agent-usage-stat", "hook.log"),
  join(HOME, ".claude-receipts", "hook.log"),
];

let red = 0, yellow = 0;
const fail = (msg) => { red++; console.log("RED  " + msg); };
const warn = (msg) => { yellow++; console.log("YEL  " + msg); };
const ok = (msg) => console.log("ok   " + msg);

if (!existsSync(DIR)) {
  fail(`shard dir missing: ${DIR}`);
  process.exit(1);
}

const shards = [];
for (const file of readdirSync(DIR)) {
  if (!file.toLowerCase().endsWith(".json")) continue;
  try {
    const shard = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    if (!shard || typeof shard !== "object" || Array.isArray(shard)) {
      throw new Error("expected a JSON object");
    }
    shards.push(shard);
  } catch (error) { fail(`unparseable shard ${file}: ${error.message}`); }
}
ok(`${shards.length} shards parsed from ${DIR}`);

if (existsSync(join(ROOT, "logbook.csv"))) {
  fail("logbook.csv reappeared beside the canonical shard directory; update the stale writer and migrate explicitly");
} else ok("no legacy logbook.csv beside canonical shards");

const candidateRoots = usageRootCandidatesFromDisk().map((candidate) => candidate.root);
const alternateRoots = [...new Set(candidateRoots.map((root) => resolve(root)))].filter(
  (root) => resolve(root) !== resolve(ROOT),
);
const usageFields = [
  "total_tokens",
  "input_tokens",
  "output_tokens",
  "cache_creation_tokens",
  "cache_read_tokens",
  "total_cost_usd",
];
const metric = (shard, field) =>
  typeof shard[field] === "number" && Number.isFinite(shard[field])
    ? shard[field]
    : null;
let forkCount = 0, supersededCount = 0;
for (const root of alternateRoots) {
  const directory = shardDirectory(root);
  if (!existsSync(directory)) continue;
  const files = readdirSync(directory).filter((file) => file.toLowerCase().endsWith(".json"));
  const missing = files.filter((file) => !existsSync(join(DIR, file)));
  const duplicates = files.filter((file) => existsSync(join(DIR, file)));
  const unsafeDuplicates = [];
  for (const file of duplicates) {
    try {
      const alternate = JSON.parse(readFileSync(join(directory, file), "utf8"));
      const canonical = JSON.parse(readFileSync(join(DIR, file), "utf8"));
      const alternateEnd = Date.parse(alternate.end_time || alternate.start_time || "");
      const canonicalEnd = Date.parse(canonical.end_time || canonical.start_time || "");
      const alternateProvider = alternate.provider || "claude";
      const canonicalProvider = canonical.provider || "claude";
      const invalidMetric = usageFields.some((field) =>
        metric(alternate, field) === null || metric(canonical, field) === null);
      const higherUsage = usageFields.some((field) =>
        metric(alternate, field) > metric(canonical, field) + 1e-9);
      if (
        alternateProvider !== canonicalProvider ||
        invalidMetric ||
        !Number.isFinite(alternateEnd) ||
        !Number.isFinite(canonicalEnd) ||
        alternateEnd > canonicalEnd ||
        higherUsage
      ) {
        unsafeDuplicates.push(file);
      }
    } catch {
      unsafeDuplicates.push(file);
    }
  }
  if (missing.length) {
    forkCount += missing.length;
    fail(`${missing.length} shard(s) exist only outside the canonical root at ${directory}; reconcile deliberately without deleting either source`);
  }
  if (unsafeDuplicates.length) {
    forkCount += unsafeDuplicates.length;
    fail(`${unsafeDuplicates.length} alternate shard(s) are newer, costlier, or unreadable at ${directory}; compare them before cleanup`);
  }
  const superseded = duplicates.length - unsafeDuplicates.length;
  if (superseded) {
    supersededCount += superseded;
    warn(`${superseded} superseded duplicate shard(s) remain at ${directory}; canonical copies are at least as current and costly`);
  }
}
if (!forkCount && !supersededCount) ok("no alternate-root shard fork");

const recentMisses = [];
const cutoff = Date.now() - 7 * 86_400_000;
for (const path of HOOK_LOGS) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const timestamp = line.match(/^\[([0-9T:.\-]+Z)\]\s+pricing miss/);
    if (!timestamp || Date.parse(timestamp[1]) < cutoff || line.includes("<synthetic>")) continue;
    recentMisses.push(line);
  }
}
const unresolvedMisses = recentMisses.filter((line) => {
  const provider = line.match(/provider=([^\s]+)/)?.[1] || "claude";
  const models = line.match(/models=([^\s]+)/)?.[1]?.split(",") || [];
  const priceFor = provider === "codex" ? codexPriceFor : claudePriceFor;
  return models.some((model) => !priceFor(model));
});
if (unresolvedMisses.length) {
  fail(`${unresolvedMisses.length} unresolved pricing miss(es) in the last 7 days:\n     ${unresolvedMisses.slice(-3).join("\n     ")}`);
} else if (recentMisses.length) {
  warn(`${recentMisses.length} recent pricing miss(es) now covered by pricing tables; verify affected sessions were regenerated`);
} else ok("no pricing misses in last 7 days");

const KNOWN_ZERO = new Set(["a615a2cf", "e5f5e2c9"]);
const zeroCost = shards.filter((shard) =>
  (shard.total_tokens || 0) > 0 &&
  !(shard.total_cost_usd > 0) &&
  !KNOWN_ZERO.has(String(shard.session_id).slice(0, 8)));
if (zeroCost.length) {
  for (const shard of zeroCost) {
    warn(`zero-cost shard ${String(shard.session_id).slice(0, 8)} (${String(shard.end_time).slice(0, 10)}, ${shard.total_tokens} tok, ${JSON.stringify(shard.models)}); regenerate if the transcript exists`);
  }
} else ok("no new zero-cost shards with tokens");

const unknownModels = new Set();
for (const shard of shards) {
  const provider = shard.provider || "claude";
  if (provider !== "claude" && provider !== "codex") {
    unknownModels.add(`${provider}:<unsupported-provider>`);
    continue;
  }
  const priceFor = provider === "codex" ? codexPriceFor : claudePriceFor;
  const models = Array.isArray(shard.models)
    ? shard.models
    : String(shard.models || "").split(/[;,]/);
  for (const model of models.map((value) => String(value).trim()).filter(Boolean)) {
    if (!priceFor(model)) unknownModels.add(`${provider}:${model}`);
  }
}
unknownModels.size
  ? warn(`models not in provider pricing tables: ${[...unknownModels].join(", ")}`)
  : ok("all shard models priced by their provider");

const lastByMachine = {};
for (const shard of shards) {
  const date = String(shard.end_time || "").slice(0, 10);
  const machine = shard.machine || "?";
  if (!lastByMachine[machine] || date > lastByMachine[machine]) lastByMachine[machine] = date;
}
for (const [machine, date] of Object.entries(lastByMachine)) {
  const age = Math.floor((Date.now() - Date.parse(date)) / 86_400_000);
  age > 14
    ? warn(`machine ${machine}: no shards for ${age} days (last ${date})`)
    : ok(`machine ${machine}: last shard ${date}`);
}

const arithmeticMismatches = shards.filter((shard) =>
  (shard.input_tokens || 0) +
  (shard.output_tokens || 0) +
  (shard.cache_creation_tokens || 0) +
  (shard.cache_read_tokens || 0) !==
  (shard.total_tokens || 0));
arithmeticMismatches.length
  ? warn(`${arithmeticMismatches.length} shard(s) with token-column arithmetic mismatch`)
  : ok("token columns consistent");

console.log(`\n${red} red, ${yellow} yellow across ${shards.length} shards`);
process.exit(red ? 1 : 0);
