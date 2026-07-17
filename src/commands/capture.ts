import { stdin } from "process";
import { readFileSync, unlinkSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import chalk from "chalk";
import ora from "ora";
import { logHookEvent } from "../utils/hook-log.js";
import {
  detectProvider,
  findSession,
} from "../providers/registry.js";
import { ConfigManager } from "../core/config-manager.js";
import { LogbookWriter } from "../core/logbook-writer.js";
import { resolveUsageRoot } from "../utils/usage-root.js";
import type { HookData } from "../types/session-hook.js";
import type { SessionProvider } from "../types/provider.js";

const execFileAsync = promisify(execFile);

export interface CaptureOptions {
  session?: string;
  detach?: boolean;
  inputFile?: string;
  quiet?: boolean;
}

export class CaptureCommand {
  private configManager = new ConfigManager();
  private logbookWriter = new LogbookWriter();

  async execute(options: CaptureOptions): Promise<void> {
    const spinner = ora({
      text: "Recording usage...",
      isSilent: !!options.quiet,
    }).start();
    logHookEvent(`invoke pid=${process.pid} cwd=${process.cwd()}`);

    try {
      const hookData = options.inputFile
        ? this.readInputFile(options.inputFile)
        : await this.readStdinIfAvailable();
      let transcriptPath: string | undefined;
      let sessionId: string | undefined;
      let provider: SessionProvider;

      if (hookData) {
        transcriptPath =
          hookData.hook_event_name === "SubagentStop"
            ? hookData.agent_transcript_path || hookData.transcript_path || undefined
            : hookData.transcript_path || undefined;
        sessionId = hookData.session_id;
        logHookEvent(
          `hook session=${sessionId} event=${hookData.hook_event_name} transcript=${transcriptPath}`,
        );
      }

      const config = await this.configManager.loadConfig();
      const { root, source } = resolveUsageRoot(config);
      logHookEvent(`data root ${root} (${source})`);

      if (transcriptPath) {
        provider = await detectProvider(transcriptPath);
      } else {
        const resolved = await findSession(options.session);
        provider = resolved.provider;
        transcriptPath = resolved.found.transcriptPath;
        sessionId = resolved.found.sessionId;
        logHookEvent(
          `manual provider=${provider.name} session=${sessionId} transcript=${transcriptPath}`,
        );
      }

      spinner.text = "Computing usage...";
      const sessionData = await provider.calculateUsage(
        transcriptPath,
        sessionId ?? "",
      );
      sessionId = sessionData.sessionId || sessionId;

      const unknown = provider.getUnknownModels();
      if (unknown.length > 0) {
        logHookEvent(
          `pricing miss provider=${provider.name} models=${unknown.join(",")} billed at $0`,
        );
      }

      if (sessionData.totalTokens <= 0) {
        spinner.info("No token usage to record.");
        logHookEvent(`skip zero-token session=${sessionId ?? "?"}`);
        return;
      }

      spinner.text = "Reading session metadata...";
      const transcriptData = await provider.parseTranscript(
        transcriptPath,
        sessionId,
      );
      const cwd = hookData?.cwd || transcriptData.cwd;
      if (cwd && (!transcriptData.gitBranch || transcriptData.gitBranch === "HEAD")) {
        const branch = await this.resolveCurrentBranch(cwd);
        if (branch) transcriptData.gitBranch = branch;
      }

      const shardPath = await this.logbookWriter.append(root, {
        sessionData,
        transcriptData,
      });
      logHookEvent(
        `done provider=${provider.name} tokens=${sessionData.totalTokens} cost=${sessionData.totalCost.toFixed(6)} shard=${shardPath}`,
      );
      spinner.succeed("Usage recorded.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      spinner.fail("Failed to record usage.");
      logHookEvent(`fatal: ${message}`);
      if (!options.quiet) console.error(chalk.red(`Error: ${message}`));
      process.exitCode = 1;
    }
  }

  private async resolveCurrentBranch(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", cwd, "branch", "--show-current"],
        { timeout: 1500, windowsHide: true },
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private readInputFile(path: string): HookData | null {
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as HookData;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logHookEvent(`input-file read failed (${path}): ${message}`);
      return null;
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  private async readStdinIfAvailable(): Promise<HookData | null> {
    return new Promise((resolve) => {
      if (stdin.isTTY) {
        resolve(null);
        return;
      }

      let data = "";
      const timeout = setTimeout(() => resolve(null), 2000);
      stdin.setEncoding("utf-8");
      stdin.on("data", (chunk) => {
        data += chunk;
      });
      stdin.on("end", () => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data) as HookData);
        } catch {
          resolve(null);
        }
      });
      stdin.resume();
    });
  }
}
