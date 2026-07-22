import { readdir } from "fs/promises";
import { basename, dirname, join } from "path";

/** Main transcript plus every recursively nested subagent transcript. */
export async function findSessionTranscriptFiles(
  mainPath: string,
  sessionId: string,
): Promise<string[]> {
  const files = [mainPath];
  const sid = sessionId || basename(mainPath).replace(/\.jsonl$/, "");
  const projectDir = dirname(mainPath);
  const candidateDirs = new Set<string>([projectDir]);

  try {
    const projectsRoot = dirname(projectDir);
    for (const entry of await readdir(projectsRoot)) {
      candidateDirs.add(join(projectsRoot, entry));
    }
  } catch {
    // Nonstandard transcript roots can only use co-located subagents.
  }

  for (const dir of candidateDirs) {
    const subagentDir = join(dir, sid, "subagents");
    try {
      for (const entry of await readdir(subagentDir, { recursive: true })) {
        if (entry.endsWith(".jsonl")) files.push(join(subagentDir, entry));
      }
    } catch {
      // Missing subagent directories are the normal no-delegation case.
    }
  }

  return [...new Set(files)].sort();
}
