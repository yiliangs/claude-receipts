import { existsSync, mkdirSync } from "fs";
import { appendFile, writeFile, readFile, open } from "fs/promises";
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
   * Record one row per session in <root>/logbook.csv. Writes the header on
   * first creation. If a row with this session_id already exists it is
   * rewritten in place rather than appended — a resumed session fires
   * SessionEnd more than once, and each firing carries the same id with grown
   * usage; one row per session, holding the latest figures, is what we want.
   * Failures are swallowed — the logbook is best-effort and must never block
   * receipt generation.
   */
  async append(root: string, data: ReceiptData): Promise<void> {
    try {
      const path = join(root, "logbook.csv");
      mkdirSync(dirname(path), { recursive: true });

      const csvRow = this.buildRow(data).map(this.escapeCell).join(",");
      const sessionId = data.sessionData.sessionId || "";

      if (!existsSync(path)) {
        await writeFile(path, HEADER.join(",") + "\n" + csvRow + "\n", "utf-8");
        return;
      }

      // Replace an existing row for the same session_id (de-dupe resumed
      // sessions) instead of appending a second one.
      if (sessionId) {
        const existing = await readFile(path, "utf-8");
        const lines = existing.split("\n");
        const idx = lines.findIndex(
          (l) => this.sessionIdOf(l) === sessionId,
        );
        if (idx >= 0) {
          lines[idx] = csvRow;
          let out = lines.join("\n");
          if (!out.endsWith("\n")) out += "\n";
          await writeFile(path, out, "utf-8");
          return;
        }
      }

      // New session — append. Don't trust the file to be newline-terminated:
      // an external editor (Excel / Sheets re-saving the CSV on Drive) or a
      // worker killed mid-append can leave the last line without its "\n",
      // which would glue the new row on. Prepend "\n" when it's missing.
      const lead = (await this.endsWithNewline(path)) ? "" : "\n";
      await appendFile(path, lead + csvRow + "\n", "utf-8");
    } catch {
      // Logbook is auxiliary — never break the hook.
    }
  }

  /**
   * session_id (3rd column) of a raw CSV line, or "" for the header / blank
   * lines. The first three columns (timestamp, slug, session_id) never contain
   * commas, so a plain split is safe even though later cells (e.g. a quoted
   * "City, ST" location) can.
   */
  private sessionIdOf(line: string): string {
    if (!line) return "";
    const parts = line.split(",");
    return parts.length >= 3 ? parts[2] : "";
  }

  /**
   * True if the file is empty or its final byte is "\n" (so a plain append
   * lands on a fresh row). Reads only the last byte — the logbook grows to
   * many rows and is never read whole here. CRLF files still end in "\n", so
   * a single-byte check is sufficient.
   */
  private async endsWithNewline(path: string): Promise<boolean> {
    const fh = await open(path, "r");
    try {
      const { size } = await fh.stat();
      if (size === 0) return true;
      const buf = Buffer.alloc(1);
      await fh.read(buf, 0, 1, size - 1);
      return buf[0] === 0x0a; // "\n"
    } finally {
      await fh.close();
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
