import { UsageCalculator } from "./usage-calculator.js";
import { TranscriptParser } from "./transcript-parser.js";
import { SessionFinder } from "./session-finder.js";
import type {
  SessionProvider,
  FoundSession,
} from "../../types/provider.js";
import type { SessionUsage } from "../../types/session.js";
import type { ParsedTranscript } from "../../types/transcript.js";

/**
 * Claude Code sessions: transcripts under `~/.claude/projects/`, per-message
 * `message.usage` billing events (deduped by message.id+requestId, subagent
 * trees scanned recursively), Anthropic pricing.
 */
export class ClaudeProvider implements SessionProvider {
  readonly name = "claude" as const;

  private calculator = new UsageCalculator();
  private parser = new TranscriptParser();
  private finder = new SessionFinder();

  findSession(query?: string): Promise<FoundSession> {
    return this.finder.find(query);
  }

  calculateUsage(
    transcriptPath: string,
    sessionId: string,
  ): Promise<SessionUsage> {
    return this.calculator.calculate(transcriptPath, sessionId);
  }

  getUnknownModels(): string[] {
    return this.calculator.getUnknownModels();
  }

  parseTranscript(
    transcriptPath: string,
    fallbackId?: string,
  ): Promise<ParsedTranscript> {
    return this.parser.parseTranscript(transcriptPath, fallbackId);
  }
}
