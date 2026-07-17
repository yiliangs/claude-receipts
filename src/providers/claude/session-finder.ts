import { readdir, stat } from "fs/promises";
import { join } from "path";
import { homeDir } from "../../utils/paths.js";
import type { FoundSession } from "../../types/provider.js";

/**
 * Locate a session transcript under the active Claude Code config directory.
 *
 * Replaces the manual-mode discovery step that previously shelled out to
 * `ccusage session --json --breakdown`. We don't need ccusage's index —
 * the JSONL filenames are themselves session UUIDs, and mtime tells us
 * which session is most recent.
 */
export class SessionFinder {
  private root: string;

  constructor(
    claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homeDir(), ".claude"),
  ) {
    this.root = join(claudeHome, "projects");
  }

  /**
   * Find a session by UUID prefix (e.g., "c8f07248") or full UUID. When
   * no query is given, returns the most-recently-modified transcript
   * across all projects.
   */
  async find(query?: string): Promise<FoundSession> {
    const all = await this.scanAll();
    if (all.length === 0) {
      throw new Error(
        `No transcripts found under ${this.root}. Has Claude Code ever run on this machine?`,
      );
    }

    if (!query) {
      // Most recent across all projects
      all.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return all[0];
    }

    const matches = all.filter((s) => s.sessionId.startsWith(query));
    if (matches.length === 0) {
      const preview = all
        .slice()
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 10)
        .map((s) => `  ${s.sessionId.slice(0, 8)}  ${s.projectPath}`)
        .join("\n");
      throw new Error(
        `No session matching "${query}". Recent sessions:\n${preview}`,
      );
    }

    // Multiple prefix matches → pick the most recent
    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return matches[0];
  }

  private async scanAll(): Promise<FoundSession[]> {
    const out: FoundSession[] = [];
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.root);
    } catch {
      return out;
    }

    for (const projectDir of projectDirs) {
      const projectAbs = join(this.root, projectDir);
      let files: string[];
      try {
        files = await readdir(projectAbs);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const sessionId = file.slice(0, -".jsonl".length);
        const transcriptPath = join(projectAbs, file);
        try {
          const s = await stat(transcriptPath);
          out.push({
            sessionId,
            transcriptPath,
            projectPath: `${projectDir}/${sessionId}`,
            mtimeMs: s.mtimeMs,
          });
        } catch {
          // skip unreadable file
        }
      }
    }
    return out;
  }
}
