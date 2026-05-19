import { stdin } from "process";
import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import boxen from "boxen";
import ora from "ora";
import { exec } from "child_process";
import { promisify } from "util";
import { DataFetcher, SessionNotIndexedError } from "../core/data-fetcher.js";
import { TranscriptParser } from "../core/transcript-parser.js";
import { ReceiptGenerator } from "../core/receipt-generator.js";
import { HtmlRenderer } from "../core/html-renderer.js";
import { ImageRenderer } from "../core/image-renderer.js";
import { ThermalPrinterRenderer } from "../core/thermal-printer.js";
import { ConfigManager } from "../core/config-manager.js";
import { LocationDetector } from "../utils/location.js";
import { WeatherFetcher } from "../utils/weather.js";
import type { SessionEndHookData } from "../types/session-hook.js";
import type { ReceiptData } from "../core/receipt-generator.js";
import type { CcusageSession } from "../types/ccusage.js";

const execAsync = promisify(exec);

export type OutputFormat = "html" | "console" | "printer" | "png" | "pdf";

export interface GenerateOptions {
  session?: string;
  output?: string[];
  location?: string;
  printer?: string;
}

export class GenerateCommand {
  private dataFetcher = new DataFetcher();
  private transcriptParser = new TranscriptParser();
  private receiptGenerator = new ReceiptGenerator();
  private htmlRenderer = new HtmlRenderer();
  private imageRenderer = new ImageRenderer();
  private thermalPrinter = new ThermalPrinterRenderer();
  private configManager = new ConfigManager();
  private locationDetector = new LocationDetector();
  private weatherFetcher = new WeatherFetcher();

  async execute(options: GenerateOptions): Promise<void> {
    const spinner = ora("Generating receipt...").start();
    this.logHookEvent(`invoke pid=${process.pid} cwd=${process.cwd()}`);

    try {
      // Check if stdin has data (called from hook)
      const stdinData = await this.readStdinIfAvailable();
      let transcriptPath: string | undefined;
      let actualSessionId: string | undefined;

      if (stdinData) {
        // Called from SessionEnd hook - use the transcript path directly!
        transcriptPath = stdinData.transcript_path;
        actualSessionId = stdinData.session_id;
        this.logHookEvent(`stdin session=${actualSessionId} transcript=${transcriptPath}`);
      } else {
        this.logHookEvent(`stdin none (TTY=${stdin.isTTY ?? "?"}) — manual mode`);
      }

      // Load config
      const config = await this.configManager.loadConfig();

      // Fetch session data from ccusage
      spinner.text = "Fetching session data...";

      let sessionData;
      try {
        if (actualSessionId) {
          // From hook or when we have the full UUID — fetch directly by ID
          // for accurate totals (avoids sub-session slice issue with --breakdown)
          sessionData = await this.fetchSessionWithRetry(actualSessionId);
        } else {
          // Manual mode — discover session by prefix/name, then fetch accurate data
          sessionData =
            await this.dataFetcher.fetchSessionData(options.session);
        }
        this.logHookEvent(`ccusage ok cost=${sessionData.totalCost} tokens=${sessionData.totalTokens}`);
      } catch (err) {
        const firstMsg = err instanceof Error ? err.message : String(err);

        if (stdinData && actualSessionId) {
          // ccusage exhausted retries — synthesize an empty-cost receipt
          // rather than vanishing silently. Sessions with no API calls
          // legitimately have no ccusage data.
          this.logHookEvent(`ccusage gave up: ${firstMsg} — synthesizing empty session`);
          sessionData = this.makeEmptySessionData(actualSessionId);
        } else if (stdinData) {
          // Hook mode but no session ID — can't recover; bail with a log.
          this.logHookEvent(`hook mode but no session_id — giving up: ${firstMsg}`);
          spinner.stop();
          return;
        } else {
          throw err;
        }
      }

      // Determine transcript path if not from hook
      if (!transcriptPath) {
        // Try to extract actual session ID from projectPath
        // Format: "project-name/actual-session-id"
        if (
          sessionData.projectPath &&
          sessionData.projectPath !== "Unknown Project"
        ) {
          const parts = sessionData.projectPath.split("/");
          actualSessionId = parts[parts.length - 1]; // Last part is the actual session ID

          const home = process.env.HOME || process.env.USERPROFILE || "";
          transcriptPath = `${home}/.claude/projects/${sessionData.projectPath}.jsonl`;
        } else {
          throw new Error(
            "Cannot determine transcript path. Session has no valid project path.",
          );
        }
      }

      // Parse transcript
      spinner.text = "Parsing transcript...";
      const transcriptData = await this.transcriptParser.parseTranscript(
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
        options.location
          ? Promise.resolve(options.location)
          : this.locationDetector.getLocation(config),
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
            case "printer":
              await this.outputToPrinter(receiptData, options, config, spinner);
              break;
            case "html":
              await this.outputToHtml(renderedHtml, fileBase, isFromHook);
              break;
            case "png":
              await this.outputToImage(renderedHtml, fileBase, "png");
              break;
            case "pdf":
              await this.outputToImage(renderedHtml, fileBase, "pdf");
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
   * Append a one-line event to ~/.claude-receipts/hook.log. Fails silently
   * so logging never breaks the hook. The log is the only window into hook
   * behavior — SessionEnd has no console.
   */
  private logHookEvent(message: string): void {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      if (!home) return;
      const dir = join(home, ".claude-receipts");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString();
      appendFileSync(
        join(dir, "hook.log"),
        `[${stamp}] ${message}\n`,
        "utf-8",
      );
    } catch {
      // log failures are not worth crashing the hook for
    }
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
        { timeout: 1500 },
      );
      const branch = stdout.trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  /**
   * Call ccusage with exponential backoff when the session hasn't been
   * indexed yet. ccusage's indexer can take 10–20s to catch up on a
   * just-ended session; the previous 1.5s single retry was producing
   * spurious $0.00 receipts for real sessions. SessionEnd runs in
   * background, so the extra wait is invisible to the user.
   */
  private async fetchSessionWithRetry(
    sessionId: string,
  ): Promise<CcusageSession> {
    const delays = [0, 3000, 8000, 15000]; // ~26s total budget
    let lastErr: unknown;

    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      try {
        const data = await this.dataFetcher.fetchSessionById(sessionId);
        if (i > 0) {
          this.logHookEvent(
            `ccusage ok on attempt ${i + 1} (waited ${delays
              .slice(0, i + 1)
              .reduce((a, b) => a + b, 0)}ms)`,
          );
        }
        return data;
      } catch (err) {
        lastErr = err;
        const isNotIndexed = err instanceof SessionNotIndexedError;
        const msg = err instanceof Error ? err.message : String(err);
        const willRetry = isNotIndexed && i < delays.length - 1;
        this.logHookEvent(
          `ccusage attempt ${i + 1} failed: ${msg}` +
            (willRetry
              ? ` — retrying in ${delays[i + 1]}ms`
              : isNotIndexed
                ? " — out of retries"
                : " — non-retryable, bailing"),
        );
        // Non-recoverable errors (e.g., ccusage missing) don't get retried.
        if (!isNotIndexed) break;
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr));
  }

  /**
   * Synthesize a zero-cost CcusageSession when ccusage has no data for the
   * session yet (very short sessions / index lag). The receipt is still
   * worth rendering — it captures location, duration, and prompts — even
   * if the cost section reads $0.00.
   */
  private makeEmptySessionData(sessionId: string): CcusageSession {
    return {
      sessionId,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      modelsUsed: [],
      modelBreakdowns: [],
    };
  }

  /**
   * Send receipt to thermal printer
   */
  private async outputToPrinter(
    receiptData: ReceiptData,
    options: GenerateOptions,
    config: { printer?: string },
    spinner: ReturnType<typeof ora>,
  ): Promise<void> {
    const printerInterface = options.printer || config.printer;
    if (!printerInterface) {
      throw new Error(
        'No printer specified. Use --printer <name> or set via: claude-receipts config --set printer=EPSON_TM_T88V',
      );
    }

    spinner.start("Sending to printer...");
    await this.thermalPrinter.printReceipt(receiptData, printerInterface);
    spinner.succeed(`Receipt sent to printer: ${printerInterface}`);
  }

  /**
   * Save receipt as HTML and optionally open in browser
   */
  private async outputToHtml(
    html: string,
    fileBase: string,
    isFromHook: boolean,
  ): Promise<void> {
    const fullPath = this.outputPathFor(fileBase, "html");
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
  ): Promise<void> {
    const { mkdir } = await import("fs/promises");
    const { dirname, resolve } = await import("path");

    const fullPath = resolve(this.expandPath(this.outputPathFor(fileBase, kind)));
    await mkdir(dirname(fullPath), { recursive: true });

    if (kind === "png") {
      await this.imageRenderer.renderPng(html, fullPath);
    } else {
      await this.imageRenderer.renderPdf(html, fullPath);
    }

    console.log(chalk.green(`Receipt saved to: ${fullPath}`));
  }

  /**
   * Build the standard output path: ~/.claude-receipts/projects/<slug>-<ts>.<ext>
   */
  private outputPathFor(fileBase: string, ext: string): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return `${home}/.claude-receipts/projects/${fileBase}.${ext}`;
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
   * Save receipt to a file
   */
  private async saveToFile(
    receipt: string,
    outputPath: string,
    sessionId: string,
  ): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises");
    const { dirname, resolve } = await import("path");

    const resolvedPath = resolve(this.expandPath(outputPath));
    const dir = dirname(resolvedPath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    // Write receipt to file
    await writeFile(resolvedPath, receipt, "utf-8");

    console.log(chalk.green(`Receipt saved to: ${resolvedPath}`));
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
        // macOS
        await execAsync(`open "${filePath}"`);
      } else if (platform === "win32") {
        // Windows
        await execAsync(`start "" "${filePath}"`);
      } else {
        // Linux
        await execAsync(`xdg-open "${filePath}"`);
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
    if (path.startsWith("~/")) {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      return path.replace(/^~/, home);
    }
    return path;
  }
}
