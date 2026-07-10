import { stdin } from "process";
import { readFileSync, unlinkSync } from "fs";
import chalk from "chalk";
import boxen from "boxen";
import ora from "ora";
import { exec } from "child_process";
import { promisify } from "util";
import { logHookEvent } from "../utils/hook-log.js";
import { ClaudeProvider } from "../providers/claude/provider.js";
import { ReceiptGenerator } from "../core/receipt-generator.js";
import { HtmlRenderer } from "../core/html-renderer.js";
import { ImageRenderer } from "../core/image-renderer.js";
import { ConfigManager } from "../core/config-manager.js";
import { LogbookWriter } from "../core/logbook-writer.js";
import { LocationDetector } from "../utils/location.js";
import { WeatherFetcher } from "../utils/weather.js";
import { expandHome } from "../utils/paths.js";
import { resolveReceiptsRoot } from "../utils/receipts-root.js";
import type { SessionEndHookData } from "../types/session-hook.js";
import type { SessionProvider } from "../types/provider.js";

const execAsync = promisify(exec);

export type OutputFormat = "html" | "console" | "png" | "pdf";

export interface GenerateOptions {
  session?: string;
  output?: string[];
  location?: string;
  detach?: boolean;
  inputFile?: string;
}

export class GenerateCommand {
  // The only provider today. When a second one lands (e.g. Codex), this
  // becomes a lookup keyed by a --provider flag / hook argument.
  private provider: SessionProvider = new ClaudeProvider();
  private receiptGenerator = new ReceiptGenerator();
  private htmlRenderer = new HtmlRenderer();
  private imageRenderer = new ImageRenderer();
  private configManager = new ConfigManager();
  private logbookWriter = new LogbookWriter();
  private locationDetector = new LocationDetector();
  private weatherFetcher = new WeatherFetcher();

  async execute(options: GenerateOptions): Promise<void> {
    // Note: --detach is handled in cli.ts by a built-ins-only shim
    // (detach-shim.ts) that never imports this module's heavy graph. By the
    // time execute() runs we are always the worker (or a manual invocation).
    const spinner = ora("Generating receipt...").start();
    this.logHookEvent(`invoke pid=${process.pid} cwd=${process.cwd()}`);

    try {
      // Read hook JSON. --input-file (the worker leg of --detach) reads from
      // disk; otherwise we probe stdin.
      const stdinData = options.inputFile
        ? this.readInputFile(options.inputFile)
        : await this.readStdinIfAvailable();
      let transcriptPath: string | undefined;
      let actualSessionId: string | undefined;

      if (stdinData) {
        transcriptPath = stdinData.transcript_path;
        actualSessionId = stdinData.session_id;
        const src = options.inputFile ? "input-file" : "stdin";
        this.logHookEvent(
          `${src} session=${actualSessionId} reason=${stdinData.reason ?? "?"} transcript=${transcriptPath}`,
        );
      } else {
        this.logHookEvent(`stdin none (TTY=${stdin.isTTY ?? "?"}) — manual mode`);
      }

      // Load config and resolve the receipts root (config → auto-detected
      // Drive mount → local default). Logging the source makes a silent
      // fork visible: a machine writing to "default" while the others share
      // a Drive root shows up in hook.log, not just in missing totals.
      const config = await this.configManager.loadConfig();
      const { root: receiptsRoot, source: rootSource } =
        resolveReceiptsRoot(config);
      this.logHookEvent(`receipts root ${receiptsRoot} (${rootSource})`);

      // Manual mode — resolve transcript path from a UUID prefix (or most
      // recent) by scanning ~/.claude/projects/, no external indexer.
      if (!transcriptPath) {
        const found = await this.provider.findSession(options.session);
        transcriptPath = found.transcriptPath;
        actualSessionId = found.sessionId;
        this.logHookEvent(`manual session=${actualSessionId} transcript=${transcriptPath}`);
      }

      // Compute usage + cost directly from the transcript JSONL.
      // No subprocess, no retry — the file is what Claude Code just wrote.
      spinner.text = "Computing session cost...";
      const sessionData = await this.provider.calculateUsage(
        transcriptPath,
        actualSessionId ?? "",
      );
      const unknown = this.provider.getUnknownModels();
      if (unknown.length > 0) {
        this.logHookEvent(
          `pricing miss for models=${unknown.join(",")} — billed at $0; add to src/providers/claude/pricing.ts`,
        );
      }
      this.logHookEvent(
        `usage cost=${sessionData.totalCost.toFixed(6)} tokens=${sessionData.totalTokens} models=${(sessionData.modelsUsed || []).join(",")}`,
      );

      // Zero-token sessions carry no signal — empty/aborted runs, headless
      // probes, or sessions whose only assistant traffic was synthetic (now
      // filtered out in usage-calculator). Skip them entirely: no receipt,
      // no $0/0-token logbook row. Bail before parsing/rendering.
      if (sessionData.totalTokens <= 0) {
        spinner.info("No token usage — skipping receipt and logbook.");
        this.logHookEvent(
          `skip: zero-token session=${actualSessionId ?? "?"} — no receipt, no logbook row`,
        );
        return;
      }

      // Parse transcript
      spinner.text = "Parsing transcript...";
      const transcriptData = await this.provider.parseTranscript(
        transcriptPath,
        actualSessionId,
      );

      // Transcripts sometimes record gitBranch as the literal "HEAD"
      // (detached state at capture, or stale value). Resolve to the
      // current branch from the recorded cwd when that happens.
      const resolvedCwd = stdinData?.cwd || transcriptData.cwd;
      if (
        resolvedCwd &&
        (!transcriptData.gitBranch || transcriptData.gitBranch === "HEAD")
      ) {
        const live = await this.resolveCurrentBranch(resolvedCwd);
        if (live) transcriptData.gitBranch = live;
      }

      // Get location + weather in parallel. Weather is best-effort —
      // null result just hides the footer block.
      spinner.text = "Resolving location and weather...";
      const [location, weather] = await Promise.all([
        this.locationDetector.getLocation(config, options.location),
        this.weatherFetcher.getCurrentWeather(),
      ]);
      this.logHookEvent(
        `weather ${weather ? `${weather.description} ${Math.round(weather.tempC)}C` : "unavailable"}`,
      );

      // Generate receipt data
      spinner.text = "Generating receipt...";
      const receiptData = {
        sessionData,
        transcriptData,
        location,
        config,
        weather,
      };

      const receipt = this.receiptGenerator.generateReceipt(receiptData);

      // Write the session's logbook shard before rendering outputs, so the
      // logbook captures every session even when downstream renderers fail.
      // Wrapped so a logbook failure never blocks the receipt — but unlike the
      // old writer, the failure is logged instead of silently swallowed.
      try {
        const shardPath = await this.logbookWriter.append(
          receiptsRoot,
          receiptData,
        );
        this.logHookEvent(`logbook shard written: ${shardPath}`);
      } catch (err) {
        this.logHookEvent(
          `logbook write FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      spinner.succeed("Receipt generated!");

      // Determine if we should output to console and/or file
      const isFromHook = !!stdinData;
      const outputFormats = [
        ...new Set(options.output || (isFromHook ? ["html"] : ["console"])),
      ] as OutputFormat[];

      const errors: Array<{ format: OutputFormat; error: Error }> = [];

      // Render HTML once if any format needs it (html, png, pdf)
      const needsHtml = outputFormats.some((f) =>
        f === "html" || f === "png" || f === "pdf",
      );
      const renderedHtml = needsHtml
        ? this.htmlRenderer.generateHtml(receiptData, receipt)
        : "";
      const slug =
        transcriptData.sessionSlug ||
        actualSessionId ||
        sessionData.sessionId;
      const fileBase = `${slug}-${this.formatTimestamp(transcriptData.endTime)}`;

      for (const format of outputFormats) {
        try {
          switch (format) {
            case "html":
              await this.outputToHtml(renderedHtml, fileBase, isFromHook, receiptsRoot);
              break;
            case "png":
              await this.outputToImage(renderedHtml, fileBase, "png", receiptsRoot);
              break;
            case "pdf":
              await this.outputToImage(renderedHtml, fileBase, "pdf", receiptsRoot);
              break;
            case "console":
              this.outputToConsole(receipt);
              break;
          }
          this.logHookEvent(`output ok: ${format} (${fileBase})`);
        } catch (err) {
          const error =
            err instanceof Error ? err : new Error("Unknown error");
          errors.push({ format, error });
          this.logHookEvent(`output fail: ${format}: ${error.message}`);

          if (outputFormats.length > 1 && !isFromHook) {
            console.log(
              chalk.yellow(
                `\n⚠ ${format} output failed: ${error.message}`,
              ),
            );
          }
        }
      }

      // Always close the puppeteer browser if it was used
      if (outputFormats.includes("png") || outputFormats.includes("pdf")) {
        try {
          await this.imageRenderer.close();
        } catch {
          // ignore cleanup errors
        }
      }

      if (errors.length === outputFormats.length) {
        // All outputs failed — throw the first error
        throw errors[0].error;
      }
      this.logHookEvent(`done formats=${outputFormats.join(",")}`);
    } catch (error) {
      spinner.fail("Failed to generate receipt");
      const msg = error instanceof Error ? error.message : "unknown error";
      this.logHookEvent(`fatal: ${msg}`);

      if (error instanceof Error) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(chalk.red("An unknown error occurred"));
      }

      process.exit(1);
    }
  }

  /**
   * Append a one-line event to the hook log. Delegates to the shared
   * (built-ins-only) logger so the detach shim and worker write the same file.
   */
  private logHookEvent(message: string): void {
    logHookEvent(message);
  }

  /**
   * Ask git for the current branch in a working directory. Returns null on
   * any failure (not a repo, git missing, detached HEAD with no symbolic
   * ref). Used to repair the transcript's "HEAD" gitBranch.
   */
  private async resolveCurrentBranch(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `git -C "${cwd}" branch --show-current`,
        { timeout: 1500, windowsHide: true },
      );
      const branch = stdout.trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  /**
   * Save receipt as HTML and optionally open in browser
   */
  private async outputToHtml(
    html: string,
    fileBase: string,
    isFromHook: boolean,
    receiptsRoot: string,
  ): Promise<void> {
    const fullPath = this.outputPathFor(receiptsRoot, fileBase, "html");
    await this.saveHtmlFile(html, fullPath);

    if (isFromHook) {
      await this.openInBrowser(fullPath);
    } else {
      console.log(chalk.cyan("\nTip: Open in browser to view!"));
    }
  }

  /**
   * Render receipt to PNG or PDF via headless Chromium and save to disk.
   */
  private async outputToImage(
    html: string,
    fileBase: string,
    kind: "png" | "pdf",
    receiptsRoot: string,
  ): Promise<void> {
    const { mkdir } = await import("fs/promises");
    const { dirname, resolve } = await import("path");

    const fullPath = resolve(this.expandPath(this.outputPathFor(receiptsRoot, fileBase, kind)));
    await mkdir(dirname(fullPath), { recursive: true });

    if (kind === "png") {
      await this.imageRenderer.renderPng(html, fullPath);
    } else {
      await this.imageRenderer.renderPdf(html, fullPath);
    }

    console.log(chalk.green(`Receipt saved to: ${fullPath}`));
  }

  /**
   * Build the standard output path under the configured receipts root.
   */
  private outputPathFor(receiptsRoot: string, fileBase: string, ext: string): string {
    return `${receiptsRoot}/${fileBase}.${ext}`;
  }

  /**
   * Compact local-time stamp keyed off the session's end. Two regenerations
   * of the same session land on the same filename (idempotent); different
   * sessions with colliding slugs get distinct files.
   */
  private formatTimestamp(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
  }

  /**
   * Display receipt to console with formatting
   */
  private outputToConsole(receipt: string): void {
    this.displayToConsole(receipt);
  }

  /**
   * Worker path: read the hook JSON the shim wrote to disk, then delete it.
   * Returning null mirrors readStdinIfAvailable() so the caller can treat
   * both inputs uniformly.
   */
  private readInputFile(path: string): SessionEndHookData | null {
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as SessionEndHookData;
      try {
        unlinkSync(path);
      } catch {
        // leftover temp files are harmless; don't fail the receipt over it
      }
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      this.logHookEvent(`input-file read failed (${path}): ${msg}`);
      return null;
    }
  }

  /**
   * Check if stdin has data and read it
   */
  private async readStdinIfAvailable(): Promise<SessionEndHookData | null> {
    return new Promise((resolve) => {
      // Check if stdin is a TTY (interactive terminal) or piped
      if (stdin.isTTY) {
        resolve(null);
        return;
      }

      let data = "";
      // 2s gives Claude Code's pipe enough slack on Windows. The previous
      // 100ms was tight enough to silently miss stdin on slow handoffs,
      // dropping us into manual-mode and producing a receipt for the
      // wrong session.
      const timeout = setTimeout(() => {
        resolve(null);
      }, 2000);

      stdin.setEncoding("utf-8");

      stdin.on("data", (chunk) => {
        data += chunk;
      });

      stdin.on("end", () => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch {
          resolve(null);
        }
      });

      // If no data after timeout, continue without stdin
      stdin.resume();
    });
  }

  /**
   * Display receipt to console with formatting
   */
  private displayToConsole(receipt: string): void {
    console.log(
      boxen(receipt, {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "cyan",
      }),
    );
  }

  /**
   * Save HTML file
   */
  private async saveHtmlFile(html: string, outputPath: string): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises");
    const { dirname, resolve } = await import("path");

    const resolvedPath = resolve(this.expandPath(outputPath));
    const dir = dirname(resolvedPath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    // Write HTML to file
    await writeFile(resolvedPath, html, "utf-8");

    console.log(chalk.green(`Receipt saved to: ${resolvedPath}`));
  }

  /**
   * Open file in default browser
   */
  private async openInBrowser(filePath: string): Promise<void> {
    const platform = process.platform;

    try {
      if (platform === "darwin") {
        await execAsync(`open "${filePath}"`, { windowsHide: true });
      } else if (platform === "win32") {
        // windowsHide: the worker runs detached with no console of its own, so
        // exec()'s default (windowsHide: false) makes Windows create a fresh
        // console for the cmd.exe that runs `start`, which flashes a terminal
        // window right before Chrome opens.
        await execAsync(`start "" "${filePath}"`, { windowsHide: true });
      } else {
        await execAsync(`xdg-open "${filePath}"`, { windowsHide: true });
      }
    } catch (error) {
      // Silently fail - file is still saved
      // Can't log error in hook context anyway
    }
  }

  /**
   * Expand ~ to home directory
   */
  private expandPath(path: string): string {
    return expandHome(path);
  }
}
