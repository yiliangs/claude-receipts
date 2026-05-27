import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { spawn } from "child_process";
import { logHookEvent } from "../utils/hook-log.js";
import type { SessionEndHookData } from "../types/session-hook.js";

/**
 * The slice of generate options the shim needs to forward to the worker.
 * Declared locally (not imported from generate.ts) so this module's import
 * graph stays limited to Node built-ins — that is the whole point of the shim.
 */
export interface DetachShimOptions {
  output?: string[];
  location?: string;
  printer?: string;
}

/**
 * Shim path: read stdin synchronously, write it to a temp file, spawn the real
 * worker as a detached child, exit. The shim deliberately avoids config
 * loading, usage calc, network, puppeteer — and, critically, even *importing*
 * the modules that do them. generate.ts pulls in geoip-lite, date-fns, and the
 * rest of the renderer graph (~1.8s of module-load time on Windows); paying
 * that here would push the worker spawn past Claude Code's SessionEnd teardown
 * on /exit, which kills the still-starting hook ("hook cancelled") before it
 * can spawn anything. Importing only built-ins keeps the shim at ~0.3s so the
 * detached worker is launched well inside the teardown window. The worker reads
 * the temp file and unlinks it when done.
 */
export function runDetachShim(options: DetachShimOptions): void {
  logHookEvent(`shim pid=${process.pid} cwd=${process.cwd()}`);

  let raw = "";
  try {
    raw = readFileSync(0, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    logHookEvent(`shim stdin read failed: ${msg}`);
    return;
  }

  if (!raw.trim()) {
    logHookEvent(`shim stdin empty — nothing to do`);
    return;
  }

  // Skip non-interactive sessions. Headless SDK / `claude -p` runs (e.g.
  // background automations) each end with reason=other and would otherwise
  // spam a receipt — plus a browser tab, PNG, PDF, and logbook row — for
  // every invocation. They're identified by the transcript's entrypoint
  // ("sdk-cli"); interactive runs report "cli". Override with
  // CLAUDE_RECEIPTS_ALL_SESSIONS=1.
  if (!process.env.CLAUDE_RECEIPTS_ALL_SESSIONS) {
    const entrypoint = hookTranscriptEntrypoint(raw);
    if (entrypoint && entrypoint.startsWith("sdk")) {
      logHookEvent(`shim skip: non-interactive entrypoint=${entrypoint}`);
      return;
    }
  }

  const tmpFile = join(
    tmpdir(),
    `claude-receipts-hook-${Date.now()}-${randomBytes(4).toString("hex")}.json`,
  );

  try {
    writeFileSync(tmpFile, raw, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    logHookEvent(`shim temp write failed: ${msg}`);
    return;
  }

  const args = [process.argv[1], "generate", "--input-file", tmpFile];
  if (options.output && options.output.length > 0) {
    args.push("--output", options.output.join(","));
  }
  if (options.location) {
    args.push("--location", options.location);
  }
  if (options.printer) {
    args.push("--printer", options.printer);
  }

  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    logHookEvent(`shim spawned worker pid=${child.pid} tmp=${tmpFile}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    logHookEvent(`shim spawn failed: ${msg}`);
    try {
      unlinkSync(tmpFile);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Peek at the SessionEnd hook JSON (raw stdin) to find the transcript, then
 * read the head of that transcript for its `entrypoint`. Interactive runs
 * report "cli"; headless SDK runs report "sdk-cli". Only the first chunk is
 * read — these transcripts can be hundreds of MB. Returns null when it can't
 * be determined (missing file, unparseable JSON, entrypoint not in the head)
 * so the caller errs toward generating the receipt rather than dropping a
 * real one.
 */
function hookTranscriptEntrypoint(rawHookJson: string): string | null {
  let transcriptPath: string | undefined;
  try {
    transcriptPath = (JSON.parse(rawHookJson) as SessionEndHookData)
      .transcript_path;
  } catch {
    return null;
  }
  if (!transcriptPath) return null;

  let fd: number | undefined;
  try {
    fd = openSync(transcriptPath, "r");
    const buf = Buffer.alloc(131072); // 128 KB head — entrypoint is on the first message record
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString("utf-8", 0, n);
    const match = /"entrypoint"\s*:\s*"([^"]+)"/.exec(head);
    return match ? match[1] : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}
