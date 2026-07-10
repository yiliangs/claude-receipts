import { mkdirSync } from "fs";
import { writeFile, readFile } from "fs/promises";
import { join } from "path";
import { hostname } from "os";
import { formatDuration } from "../utils/formatting.js";
import type { ReceiptData } from "./receipt-generator.js";

/**
 * One column-named record per session, the JSON shard's shape. Field names
 * mirror the legacy logbook.csv header so the portal's build-data can normalize
 * CSV rows and shards through one code path. `models` is a real array here
 * (the CSV packed them into a ";"-joined string).
 */
export interface LogbookRecord {
  timestamp: string;
  session_slug: string;
  session_id: string;
  project: string;
  branch: string;
  cwd: string;
  machine: string;
  location: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  duration_human: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  models: string[];
  /** Which tool produced the session. Shards written before 2026-07-09 lack
   *  the field — consumers default it to "claude". */
  provider: string;
}

/**
 * Records one session per JSON file under <root>/logbook.d/.
 *
 * Why per-session files instead of one append-only logbook.csv: the logbook
 * lives on Google Drive File Stream and is shared across machines. Appending
 * rewrites the whole shared file, and Drive resolves any version skew with
 * last-writer-wins — silently dropping rows that lose the race (receipts, being
 * unique new files, never conflicted, which is why they always survived while
 * logbook rows sporadically vanished). Giving every session its own uniquely
 * named file removes the conflict surface entirely.
 *
 * A resumed session fires SessionEnd more than once with the same id and grown
 * usage; re-writing the same-named shard keeps one record holding the latest
 * figures. The portal's build-data merges these shards with the legacy CSV.
 */
export class LogbookWriter {
  static readonly SHARD_DIR = "logbook.d";

  /**
   * Write this session's shard and return its path. Throws on failure — the
   * old single CSV writer swallowed every error, which is exactly how the data
   * loss stayed invisible. The caller logs the outcome and must not let a
   * logbook failure block receipt rendering.
   */
  async append(root: string, data: ReceiptData): Promise<string> {
    const dir = join(root, LogbookWriter.SHARD_DIR);
    mkdirSync(dir, { recursive: true });

    const record = this.buildRecord(data);
    const base =
      record.session_id ||
      `${record.session_slug || "session"}-${record.end_time}`;
    const name = base.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = join(dir, `${name}.json`);

    await writeFile(path, JSON.stringify(record, null, 2), "utf-8");

    // Read the bytes back: Drive can accept a write and later revert it, and a
    // unique new file is the case that has always persisted, so a mismatch here
    // is a real red flag worth surfacing rather than trusting the write blind.
    const back = JSON.parse(await readFile(path, "utf-8")) as LogbookRecord;
    if (back.session_id !== record.session_id) {
      throw new Error(`shard verify mismatch for ${name}.json`);
    }
    return path;
  }

  private buildRecord(data: ReceiptData): LogbookRecord {
    const { sessionData, transcriptData, location } = data;
    const durationMs =
      transcriptData.endTime.getTime() - transcriptData.startTime.getTime();
    const durationSec = Math.max(0, Math.floor(durationMs / 1000));
    const models = (sessionData.modelBreakdowns || []).map((m) => m.modelName);

    return {
      timestamp: transcriptData.endTime.toISOString(),
      session_slug: transcriptData.sessionSlug || "",
      session_id: sessionData.sessionId || "",
      project: transcriptData.projectName || "",
      branch: transcriptData.gitBranch || "",
      cwd: transcriptData.cwd || "",
      machine: hostname(),
      location: location || "",
      start_time: transcriptData.startTime.toISOString(),
      end_time: transcriptData.endTime.toISOString(),
      duration_seconds: durationSec,
      duration_human: formatDuration(
        transcriptData.startTime,
        transcriptData.endTime,
      ),
      input_tokens: sessionData.inputTokens ?? 0,
      output_tokens: sessionData.outputTokens ?? 0,
      cache_creation_tokens: sessionData.cacheCreationTokens ?? 0,
      cache_read_tokens: sessionData.cacheReadTokens ?? 0,
      total_tokens: sessionData.totalTokens ?? 0,
      total_cost_usd: Number((sessionData.totalCost ?? 0).toFixed(6)),
      models,
      provider: sessionData.provider,
    };
  }
}
