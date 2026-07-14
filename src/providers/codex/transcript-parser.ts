import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { expandHome } from "../../utils/paths.js";
import type { CodexRolloutRecord } from "./transcript-format.js";
import type { ParsedTranscript } from "../../types/transcript.js";

export class TranscriptParser {
  async parseTranscript(
    transcriptPath: string,
    fallbackId?: string,
  ): Promise<ParsedTranscript> {
    const expanded = expandHome(transcriptPath);
    if (!existsSync(expanded)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    const content = await readFile(expanded, "utf-8");
    const records: CodexRolloutRecord[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A rollout can be read while Codex is writing its final JSONL line.
      }
    }

    const meta = records.find((x) => x.type === "session_meta")?.payload;
    const latestTurn = [...records]
      .reverse()
      .find((x) => x.type === "turn_context")?.payload;
    const sessionId = meta?.id || meta?.session_id || fallbackId || "unknown-session";
    const firstPrompt = this.firstPrompt(records);
    const timestamps = records
      .map((x) => x.timestamp)
      .filter((x): x is string => !!x)
      .map((x) => new Date(x))
      .filter((x) => !Number.isNaN(x.getTime()));
    const cwd = latestTurn?.cwd || meta?.cwd;
    const userMessageCount = records.filter(
      (x) => x.type === "event_msg" && x.payload?.type === "user_message",
    ).length;
    const assistantMessageCount = records.filter(
      (x) => x.type === "event_msg" && x.payload?.type === "agent_message",
    ).length;

    return {
      sessionSlug: this.slugify(firstPrompt, sessionId),
      firstPrompt,
      startTime: timestamps[0] || new Date(),
      endTime: timestamps[timestamps.length - 1] || new Date(),
      userMessageCount,
      assistantMessageCount,
      totalMessages: userMessageCount + assistantMessageCount,
      projectName: cwd ? this.basename(cwd) : undefined,
      gitBranch: meta?.git?.branch,
      cwd,
    };
  }

  private firstPrompt(records: CodexRolloutRecord[]): string {
    const event = records.find(
      (x) =>
        x.type === "event_msg" &&
        x.payload?.type === "user_message" &&
        typeof x.payload.message === "string",
    );
    if (typeof event?.payload?.message === "string") {
      return this.truncate(event.payload.message.trim(), 100);
    }

    const item = records.find(
      (x) =>
        x.type === "response_item" &&
        x.payload?.type === "message" &&
        x.payload.role === "user",
    );
    const text = item?.payload?.content
      ?.filter((x) => x.type === "input_text" && x.text)
      .map((x) => x.text)
      .join(" ");
    return text ? this.truncate(text.trim(), 100) : "No prompt available";
  }

  private slugify(prompt: string, fallbackId: string): string {
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    return words.length > 0 ? words.join("-") : fallbackId.slice(0, 8);
  }

  private basename(path: string): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  }

  private truncate(text: string, maxLength: number): string {
    return text.length <= maxLength
      ? text
      : `${text.slice(0, maxLength).trim()}...`;
  }
}
