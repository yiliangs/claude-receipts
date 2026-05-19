import { existsSync, mkdirSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { hostname } from "os";
import { formatDuration } from "../utils/formatting.js";
import type { ReceiptData } from "./receipt-generator.js";

const HEADER = [
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

export class LogbookWriter {
  /**
   * Append one row per session to <root>/logbook.csv. Writes the header on
   * first creation. Failures are swallowed — the logbook is best-effort and
   * must never block receipt generation.
   */
  async append(root: string, data: ReceiptData): Promise<void> {
    try {
      const path = join(root, "logbook.csv");
      mkdirSync(dirname(path), { recursive: true });

      const row = this.buildRow(data);
      const csvLine = row.map(this.escapeCell).join(",") + "\n";

      if (!existsSync(path)) {
        await writeFile(path, HEADER.join(",") + "\n" + csvLine, "utf-8");
      } else {
        await appendFile(path, csvLine, "utf-8");
      }
    } catch {
      // Logbook is auxiliary — never break the hook.
    }
  }

  private buildRow(data: ReceiptData): string[] {
    const { sessionData, transcriptData, location } = data;
    const durationMs =
      transcriptData.endTime.getTime() - transcriptData.startTime.getTime();
    const durationSec = Math.max(0, Math.floor(durationMs / 1000));

    const models = (sessionData.modelBreakdowns || [])
      .map((m) => m.modelName)
      .join(";");

    return [
      transcriptData.endTime.toISOString(),
      transcriptData.sessionSlug || "",
      sessionData.sessionId || "",
      transcriptData.projectName || "",
      transcriptData.gitBranch || "",
      transcriptData.cwd || "",
      hostname(),
      location || "",
      transcriptData.startTime.toISOString(),
      transcriptData.endTime.toISOString(),
      String(durationSec),
      formatDuration(transcriptData.startTime, transcriptData.endTime),
      String(sessionData.inputTokens ?? 0),
      String(sessionData.outputTokens ?? 0),
      String(sessionData.cacheCreationTokens ?? 0),
      String(sessionData.cacheReadTokens ?? 0),
      String(sessionData.totalTokens ?? 0),
      (sessionData.totalCost ?? 0).toFixed(6),
      models,
    ];
  }

  /**
   * CSV escape per RFC 4180: wrap in quotes when the value contains a comma,
   * quote, or newline; double internal quotes.
   */
  private escapeCell(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
