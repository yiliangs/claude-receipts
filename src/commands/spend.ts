import { summarizeSpend } from "../core/spend-summary.js";
import { resolveUsageRootFromDisk } from "../utils/usage-root.js";

export type SpendFormat = "human" | "raw" | "rounded" | "json";

export interface SpendOptions {
  days?: string;
  format?: SpendFormat;
  strict?: boolean;
}

export class SpendCommand {
  async execute(options: SpendOptions): Promise<void> {
    try {
      const days = parseDays(options.days);
      const format = options.format ?? "human";
      const { root } = resolveUsageRootFromDisk();
      const summary = await summarizeSpend({
        root,
        days,
        strict: options.strict,
      });

      if (summary.skippedShards > 0) {
        console.error(
          `Skipped ${summary.skippedShards} malformed usage shard(s).`,
        );
      }

      if (format === "raw") {
        console.log(summary.totalCostUsd.toFixed(6));
      } else if (format === "rounded") {
        console.log(String(summary.roundedDollars));
      } else if (format === "json") {
        console.log(JSON.stringify(summary));
      } else {
        console.log(
          `$${summary.totalCostUsd.toFixed(2)} over ${days} days ` +
            `(${summary.includedShards} sessions)`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }
}

function parseDays(value: string | undefined): number {
  const days = Number(value ?? "30");
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("--days must be a positive integer");
  }
  return days;
}
