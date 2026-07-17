import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import ora from "ora";
import { ConfigManager } from "../core/config-manager.js";
import { LogbookWriter, type LogbookRecord } from "../core/logbook-writer.js";
import { CodexProvider } from "../providers/codex/provider.js";
import { SessionFinder } from "../providers/codex/session-finder.js";
import { fingerprintTranscriptFile } from "../providers/codex/transcript-fingerprint.js";
import { resolveUsageRoot } from "../utils/usage-root.js";

export interface SyncOptions {
  quiet?: boolean;
}

/** Reconcile local Codex rollouts into idempotent per-session shards. */
export class SyncCommand {
  private configManager = new ConfigManager();
  private finder = new SessionFinder();
  private provider = new CodexProvider();
  private writer = new LogbookWriter();

  async execute(options: SyncOptions = {}): Promise<number> {
    const spinner = ora({
      text: "Reconciling Codex turns...",
      isSilent: !!options.quiet,
    }).start();
    const config = await this.configManager.loadConfig();
    const { root } = resolveUsageRoot(config);
    const sessions = await this.finder.findAll();
    let updated = 0;
    const failures: string[] = [];

    for (const found of sessions) {
      try {
        const shardPath = join(
          root,
          LogbookWriter.SHARD_DIR,
          `${found.sessionId}.json`,
        );
        const sourceFingerprint = await fingerprintTranscriptFile(
          found.transcriptPath,
        );
        if (!(await this.needsSync(sourceFingerprint, shardPath))) continue;

        const sessionData = await this.provider.calculateUsage(
          found.transcriptPath,
          found.sessionId,
        );
        if (sessionData.totalTokens <= 0) continue;
        const transcriptData = await this.provider.parseTranscript(
          found.transcriptPath,
          sessionData.sessionId,
        );
        await this.writer.append(root, { sessionData, transcriptData });
        updated++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${found.sessionId}: ${message}`);
      }
    }

    if (failures.length > 0) {
      spinner.fail("Failed to reconcile all Codex records.");
      throw new Error(failures.join("\n"));
    }

    spinner.succeed(
      updated > 0
        ? `Reconciled ${updated} Codex session${updated === 1 ? "" : "s"}.`
        : "Codex records are current.",
    );
    return updated;
  }

  private async needsSync(
    sourceFingerprint: string,
    shardPath: string,
  ): Promise<boolean> {
    if (!existsSync(shardPath)) return true;
    try {
      const content = await readFile(shardPath, "utf-8");
      const record = JSON.parse(content) as LogbookRecord;
      return (
        !record.turns?.length ||
        record.source_fingerprint !== sourceFingerprint
      );
    } catch {
      return true;
    }
  }
}
