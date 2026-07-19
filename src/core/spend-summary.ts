import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { shardDirectory } from "../utils/usage-root.js";
import { utcCalendarWindow } from "../utils/utc-window.js";

export interface SpendSummaryOptions {
  root: string;
  days: number;
  anchorMs?: number;
  strict?: boolean;
}

export interface SpendSummary {
  root: string;
  shardDir: string;
  days: number;
  cutoff: string;
  through: string;
  totalCostUsd: number;
  roundedDollars: number;
  includedShards: number;
  skippedShards: number;
  scannedShards: number;
}

interface SpendShard {
  end_time?: unknown;
  start_time?: unknown;
  total_cost_usd?: unknown;
}

export async function summarizeSpend(
  options: SpendSummaryOptions,
): Promise<SpendSummary> {
  const anchorMs = options.anchorMs ?? Date.now();
  const window = utcCalendarWindow(anchorMs, options.days);
  const shardDir = shardDirectory(options.root);
  const entries = (await readdir(shardDir)).filter((name) =>
    name.toLowerCase().endsWith(".json"),
  );

  let totalCostUsd = 0;
  let includedShards = 0;
  let skippedShards = 0;

  for (const name of entries) {
    let shard: SpendShard;
    try {
      const parsed = JSON.parse(await readFile(join(shardDir, name), "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Shard must contain a JSON object");
      }
      shard = parsed as SpendShard;
    } catch {
      skippedShards++;
      continue;
    }

    const cost = shard.total_cost_usd;
    const timestamp = shardTimestamp(shard);
    if (
      typeof cost !== "number" ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      timestamp === null
    ) {
      skippedShards++;
      continue;
    }
    if (timestamp < window.startMs || timestamp > window.endMs) continue;

    totalCostUsd += cost;
    includedShards++;
  }

  if (options.strict && skippedShards > 0) {
    throw new Error(
      `Cannot produce a complete spend summary: ${skippedShards} malformed shard(s)`,
    );
  }

  return {
    root: options.root,
    shardDir,
    days: options.days,
    cutoff: new Date(window.startMs).toISOString(),
    through: new Date(window.endMs).toISOString(),
    totalCostUsd,
    roundedDollars: Math.round(totalCostUsd),
    includedShards,
    skippedShards,
    scannedShards: entries.length,
  };
}

function shardTimestamp(shard: SpendShard): number | null {
  for (const value of [shard.end_time, shard.start_time]) {
    if (typeof value !== "string") continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}
