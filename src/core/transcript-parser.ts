import { readFile } from "fs/promises";
import { existsSync } from "fs";
import type {
  TranscriptMessage,
  ParsedTranscript,
} from "../types/transcript.js";

export class TranscriptParser {
  /**
   * Parse a transcript JSONL file.
   *
   * @param fallbackId Used for the slug when the transcript has no slug field
   *   (new transcript format leaves `slug: null` on user messages). First 8
   *   chars are taken — keeps filenames short but unique enough to disambiguate.
   */
  async parseTranscript(
    transcriptPath: string,
    fallbackId?: string,
  ): Promise<ParsedTranscript> {
    // Expand ~ to home directory (HOME is unset in some Windows shells)
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const expandedPath = transcriptPath.replace(/^~/, home);

    if (!existsSync(expandedPath)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    const content = await readFile(expandedPath, "utf-8");
    const lines = content.trim().split("\n");

    const messages: TranscriptMessage[] = lines
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    // Extract session metadata
    const userMessages = messages.filter((m) => m.type === "user");
    const assistantMessages = messages.filter((m) => m.type === "assistant");

    const firstUserMessage = userMessages[0];
    const firstPrompt = this.extractPromptText(firstUserMessage);
    const sessionSlug =
      firstUserMessage?.slug ||
      (fallbackId ? fallbackId.slice(0, 8) : null) ||
      "unknown-session";

    // Calculate duration
    const timestamps = messages
      .filter((m) => m.timestamp)
      .map((m) => new Date(m.timestamp));

    const startTime = timestamps[0] || new Date();
    const endTime = timestamps[timestamps.length - 1] || new Date();

    // Prefer the most recent cwd / gitBranch — branches change mid-session
    // (checkout, new branch), and only the last value reflects where the
    // work actually landed.
    const lastCwd = [...messages].reverse().find((m) => m.cwd)?.cwd;
    const lastBranch = [...messages]
      .reverse()
      .find((m) => m.gitBranch)?.gitBranch;
    const projectName = lastCwd ? this.basename(lastCwd) : undefined;

    return {
      sessionSlug,
      firstPrompt,
      startTime,
      endTime,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      totalMessages: messages.length,
      projectName,
      gitBranch: lastBranch,
      cwd: lastCwd,
    };
  }

  /** Last path segment of a cwd, tolerant of either slash style. */
  private basename(path: string): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  }

  /**
   * Extract text from a user message
   */
  private extractPromptText(message: TranscriptMessage | undefined): string {
    if (!message?.message?.content) {
      return "No prompt available";
    }

    const content = message.message.content;

    // Handle string content
    if (typeof content === "string") {
      return this.truncateText(content, 100);
    }

    // Handle array content (multipart messages)
    if (Array.isArray(content)) {
      const textParts = content
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join(" ");

      return this.truncateText(textParts, 100);
    }

    return "No prompt available";
  }

  /**
   * Truncate text to a maximum length
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength).trim() + "...";
  }
}
