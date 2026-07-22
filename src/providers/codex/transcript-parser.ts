import type { ParsedTranscript } from "../../types/transcript.js";
import { readCodexSnapshot } from "./incremental-snapshot.js";

/** Incrementally derive Codex metadata from the same cached rollout snapshot. */
export class TranscriptParser {
  async parseTranscript(
    transcriptPath: string,
    fallbackId = "unknown-session",
  ): Promise<ParsedTranscript> {
    const snapshot = await readCodexSnapshot(transcriptPath, fallbackId);
    return snapshot.transcriptData;
  }
}
