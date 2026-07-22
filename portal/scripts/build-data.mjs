#!/usr/bin/env node
/** Build the portal's compact browser artifacts from per-session shards. */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export async function buildPortalData(options = {}) {
  const root = options.root || (await canonicalRoot());
  const outDir = resolve(options.outDir || resolve(here, "../public/data"));
  const shardDir = root ? resolve(root, "logbook.d") : null;

  if (!shardDir || !existsSync(shardDir)) {
    throw new Error(`Usage data not found: ${shardDir || "unresolved data root"}`);
  }

  const byId = new Map();
  const noId = [];
  let shardCount = 0;
  let badShards = 0;

  for (const file of readdirSync(shardDir)) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    try {
      const session = normalizeSession(
        JSON.parse(readFileSync(resolve(shardDir, file), "utf8")),
      );
      if (!session) continue;
      if (session.sid) byId.set(session.sid, session);
      else noId.push(session);
      shardCount++;
    } catch (error) {
      badShards++;
      console.warn(
        `[build-data] skipping ${file}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  const sessions = [...byId.values(), ...noId].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
  const projects = new Set();
  const machines = new Set();
  let minStart = Infinity;
  let maxStart = -Infinity;
  let totalCost = 0;

  for (const session of sessions) {
    const time = Date.parse(session.start);
    minStart = Math.min(minStart, time);
    maxStart = Math.max(maxStart, time);
    totalCost += session.cost;
    projects.add(session.project);
    machines.add(session.machine);
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    source: root,
    shardDir,
    sessions: sessions.length,
    projects: projects.size,
    machines: machines.size,
    totalCost: Math.round(totalCost * 100) / 100,
    span: sessions.length
      ? {
          from: new Date(minStart).toISOString(),
          to: new Date(maxStart).toISOString(),
        }
      : { from: null, to: null },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "sessions.json"), JSON.stringify(sessions));
  writeFileSync(resolve(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(
    `[build-data] ${sessions.length} sessions (${shardCount} shards` +
      `${badShards ? `, ${badShards} skipped` : ""}) · ${projects.size} projects · ` +
      `$${meta.totalCost.toLocaleString("en-US")} -> ${outDir}`,
  );
  return meta;
}

async function canonicalRoot() {
  const { resolveUsageRootFromDisk } = await import(
    "../../dist/utils/usage-root.js"
  );
  return resolveUsageRootFromDisk().root;
}

function normalizeSession(record) {
  const start = record.start_time;
  if (!start || Number.isNaN(Date.parse(start))) return null;
  return {
    slug: record.session_slug || String(record.session_id || "").slice(0, 8) || "-",
    sid: String(record.session_id || ""),
    project: String(record.project || "-").trim(),
    branch: String(record.branch || "").trim(),
    cwd: record.cwd || "",
    machine: String(record.machine || "-").trim(),
    start,
    end: record.end_time || null,
    durSec: number(record.duration_seconds),
    durHuman: record.duration_human || "",
    input: number(record.input_tokens),
    output: number(record.output_tokens),
    cacheCreate: number(record.cache_creation_tokens),
    cacheRead: number(record.cache_read_tokens),
    totalTokens: number(record.total_tokens),
    cost: number(record.total_cost_usd),
    models: Array.isArray(record.models)
      ? record.models.map(String).map((model) => model.trim()).filter(Boolean)
      : String(record.models || "").split(/[;,]/).map((model) => model.trim()).filter(Boolean),
    turns: Array.isArray(record.turns)
      ? record.turns.map(normalizeTurn).filter(Boolean)
      : [],
    provider: String(record.provider || "claude"),
    byVendor: vendorSplit(record),
  };
}

/**
 * Split a session's spend and tokens by MODEL VENDOR, which is independent of
 * `provider` (the host tool). Claude Code can route to GPT, so charting spend by
 * provider files OpenAI usage under Anthropic.
 *
 * Shards written from 2026-07-20 carry `model_breakdowns` and split exactly.
 * Older shards only recorded model NAMES, so we attribute the session total to
 * the single vendor its models belong to — exact unless a pre-2026-07-20 session
 * mixed vendors, which none in the corpus do. A mixed legacy shard falls back to
 * splitting by token share rather than silently picking one vendor.
 */
function vendorSplit(record) {
  const split = {};
  const add = (vendor, cost, tokens) => {
    const bucket = (split[vendor] ??= { cost: 0, tokens: 0 });
    bucket.cost += cost;
    bucket.tokens += tokens;
  };

  if (Array.isArray(record.model_breakdowns) && record.model_breakdowns.length) {
    for (const breakdown of record.model_breakdowns) {
      add(
        breakdown.vendor || vendorForModel(String(breakdown.model || "")),
        number(breakdown.total_cost_usd),
        number(breakdown.total_tokens),
      );
    }
    return split;
  }

  const models = Array.isArray(record.models) ? record.models : [];
  const vendors = [...new Set(models.map((m) => vendorForModel(String(m))))];
  const cost = number(record.total_cost_usd);
  const tokens = number(record.total_tokens);
  if (vendors.length <= 1) {
    add(vendors[0] || "unknown", cost, tokens);
  } else {
    for (const vendor of vendors) add(vendor, cost / vendors.length, tokens / vendors.length);
  }
  return split;
}

/** Mirrors src/core/model-vendor.ts — kept inline so the builder stays dist-free. */
function vendorForModel(model) {
  const id = model.trim().toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt") || id.startsWith("codex")) return "openai";
  return "unknown";
}

function normalizeTurn(record) {
  const start = record?.start_time;
  const end = record?.end_time || start;
  if (!start || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return null;
  }
  return {
    id: String(record.turn_id || ""),
    start,
    end,
    input: number(record.input_tokens),
    output: number(record.output_tokens),
    cacheCreate: number(record.cache_creation_tokens),
    cacheRead: number(record.cache_read_tokens),
    totalTokens: number(record.total_tokens),
    cost: number(record.total_cost_usd),
    models: Array.isArray(record.models)
      ? record.models.map(String).map((model) => model.trim()).filter(Boolean)
      : [],
  };
}

function number(value) {
  const parsed = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cliOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = cliOption("--root") || process.env.AGENT_USAGE_STAT_DATA_ROOT;
  const outDir = cliOption("--output");
  buildPortalData({ root, outDir }).catch((error) => {
    console.error(`[build-data] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
