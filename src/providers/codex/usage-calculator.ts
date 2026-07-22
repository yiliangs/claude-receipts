import type { SessionUsage } from "../../types/session.js";
import { readCodexSnapshot } from "./incremental-snapshot.js";

/** Incrementally derive Codex billing from one append-only rollout. */
export class UsageCalculator {
  private unknownModels: string[] = [];

  async calculate(
    transcriptPath: string,
    fallbackSessionId: string,
  ): Promise<SessionUsage> {
    const snapshot = await readCodexSnapshot(
      transcriptPath,
      fallbackSessionId,
    );
    this.unknownModels = snapshot.unknownModels;
    return snapshot.sessionData;
  }

  getUnknownModels(): string[] {
    return [...this.unknownModels];
  }
}
