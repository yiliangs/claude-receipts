import { readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { homeDir } from "../../utils/paths.js";
import type { FoundSession } from "../../types/provider.js";

/** Locate rollout JSONL files under active and archived Codex session roots. */
export class SessionFinder {
  private roots: string[];

  constructor(codexHome = process.env.CODEX_HOME || join(homeDir(), ".codex")) {
    this.roots = [
      join(codexHome, "sessions"),
      join(codexHome, "archived_sessions"),
    ];
  }

  async find(query?: string): Promise<FoundSession> {
    const all = await this.scanAll();
    if (all.length === 0) {
      throw new Error(
        `No Codex rollouts found under ${this.roots.join(" or ")}.`,
      );
    }

    const matches = query
      ? all.filter(
          (x) =>
            x.sessionId.startsWith(query) ||
            x.transcriptPath.toLowerCase().includes(query.toLowerCase()),
        )
      : all;
    if (matches.length === 0) {
      throw new Error(`No Codex session matching "${query}".`);
    }

    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return matches[0];
  }

  private async scanAll(): Promise<FoundSession[]> {
    const out: FoundSession[] = [];
    for (const root of this.roots) {
      for (const transcriptPath of await this.walk(root)) {
        const name = transcriptPath.replace(/\\/g, "/").split("/").pop() || "";
        const match = /([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i.exec(name);
        if (!match) continue;
        try {
          const info = await stat(transcriptPath);
          out.push({
            sessionId: match[1],
            transcriptPath,
            projectPath: relative(root, transcriptPath),
            mtimeMs: info.mtimeMs,
          });
        } catch {
          // File disappeared between directory scan and stat.
        }
      }
    }
    return out;
  }

  private async walk(root: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.walk(path)));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
    return files;
  }
}
