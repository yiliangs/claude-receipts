import { open } from "fs/promises";
import { ClaudeProvider } from "./claude/provider.js";
import { CodexProvider } from "./codex/provider.js";
import type {
  FoundSession,
  ProviderName,
  SessionProvider,
} from "../types/provider.js";

export interface ResolvedSession {
  provider: SessionProvider;
  found: FoundSession;
}

/** Create a provider explicitly for programmatic library use. */
export function providerByName(name: ProviderName): SessionProvider {
  if (name === "claude") return new ClaudeProvider();
  if (name === "codex") return new CodexProvider();
  throw new Error(`Unsupported provider: ${String(name)}`);
}

/** Detect a transcript by wire format, with path only as a final fallback. */
export async function detectProvider(
  transcriptPath: string,
): Promise<SessionProvider> {
  let head = "";
  try {
    const handle = await open(transcriptPath, "r");
    try {
      const buffer = Buffer.alloc(131_072);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.toString("utf-8", 0, result.bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    // Let the selected provider surface the useful missing-file error later.
  }

  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { type?: string; payload?: unknown };
      if (record.type === "session_meta" || record.type === "turn_context") {
        return new CodexProvider();
      }
      if (record.type === "user" || record.type === "assistant") {
        return new ClaudeProvider();
      }
    } catch {
      // Keep scanning; a partial final line can appear in the head chunk.
    }
  }

  const normalized = transcriptPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/.codex/")) return new CodexProvider();
  if (normalized.includes("/.claude/")) return new ClaudeProvider();
  throw new Error(`Could not detect transcript provider: ${transcriptPath}`);
}

/** Find the newest matching session across both provider stores. */
export async function findSession(
  query?: string,
): Promise<ResolvedSession> {
  const providers: SessionProvider[] = [
    new ClaudeProvider(),
    new CodexProvider(),
  ];
  const results = await Promise.all(
    providers.map(async (provider) => {
      try {
        return { provider, found: await provider.findSession(query) };
      } catch {
        return null;
      }
    }),
  );
  const matches = results.filter((x): x is ResolvedSession => x !== null);
  if (matches.length === 0) {
    throw new Error(
      query
        ? `No Claude Code or Codex session matching "${query}".`
        : "No Claude Code or Codex sessions found.",
    );
  }
  matches.sort((a, b) => b.found.mtimeMs - a.found.mtimeMs);
  return matches[0];
}
