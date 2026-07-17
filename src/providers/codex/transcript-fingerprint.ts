import { createHash } from "crypto";
import { open } from "fs/promises";

const TAIL_BYTES = 64 * 1024;
// Bump when Codex parsing or pricing changes require existing shards to be
// recomputed even though their rollout bytes did not change.
const SNAPSHOT_VERSION = "codex-usage-v1";

/** Fingerprint append-only rollout content without hashing the full history. */
export function fingerprintTranscriptContent(content: string): string {
  const bytes = Buffer.from(content, "utf-8");
  return fingerprint(
    bytes.length,
    bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES)),
  );
}

/** Read only the final 64 KB so unchanged long-running sessions stay cheap. */
export async function fingerprintTranscriptFile(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, TAIL_BYTES);
    const tail = Buffer.alloc(length);
    const { bytesRead } = await handle.read(
      tail,
      0,
      length,
      Math.max(0, info.size - length),
    );
    return fingerprint(info.size, tail.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function fingerprint(size: number, tail: Buffer): string {
  const hash = createHash("sha256").update(tail).digest("hex");
  return `${SNAPSHOT_VERSION}:${size}:${hash}`;
}
