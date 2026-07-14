import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import prompts from "prompts";
import ora from "ora";
import { ConfigManager } from "../core/config-manager.js";
import { homeDir } from "../utils/paths.js";
import {
  detectSharedUsageRoot,
  resolveUsageRoot,
} from "../utils/usage-root.js";
import type { AppConfig } from "../types/config.js";

interface ClaudeSettings {
  hooks?: {
    SessionEnd?: Array<{
      hooks: Array<{
        type: string;
        command: string;
      }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CommandHook {
  type: "command";
  command: string;
  commandWindows?: string;
  timeout?: number;
  statusMessage?: string;
}

interface CodexHooksFile {
  hooks?: Record<
    string,
    Array<{
      matcher?: string;
      hooks: CommandHook[];
    }>
  >;
  [key: string]: unknown;
}

export interface SetupOptions {
  uninstall?: boolean;
  provider?: "claude" | "codex" | "all";
}

export class SetupCommand {
  private configManager = new ConfigManager();
  private settingsPath: string;
  private codexHooksPath: string;

  constructor() {
    this.settingsPath = join(homeDir(), ".claude", "settings.json");
    this.codexHooksPath = join(homeDir(), ".codex", "hooks.json");
  }

  async execute(options: SetupOptions): Promise<void> {
    console.log(chalk.cyan.bold("\nAgent Usage Stat Setup\n"));

    try {
      if (options.uninstall) {
        await this.uninstall(options.provider || "all");
      } else {
        await this.install(options.provider || "all");
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`\nError: ${error.message}`));
      } else {
        console.error(chalk.red("\nAn unknown error occurred"));
      }
      process.exit(1);
    }
  }

  /** Install the selected provider hooks. */
  private async install(target: "claude" | "codex" | "all"): Promise<void> {
    const installClaude = target === "claude" || target === "all";
    const installCodex = target === "codex" || target === "all";
    // Re-running setup preserves the configured data root.
    const existing = await this.configManager.loadConfig();

    // When no data root is configured but another machine already
    // established a shared one on a Google Drive mount, offer to join it —
    // otherwise this machine silently forks onto the local default and its
    // sessions never reach the shared logbook.
    const detectedRoot = existing.dataRoot?.trim()
      ? null
      : detectSharedUsageRoot();

    // Prompt user for configuration
    const answers = await prompts([
      ...(detectedRoot
        ? [
            {
              type: "confirm" as const,
              name: "useDetectedRoot",
              message: `Shared usage data found at ${detectedRoot}. Use it?`,
              initial: true,
            },
          ]
        : []),
    ]);

    // User cancelled
    if (detectedRoot && answers.useDetectedRoot === undefined) {
      console.log(chalk.yellow("\nSetup cancelled"));
      return;
    }

    const spinner = ora("Setting up hook...").start();

    try {
      // Persisting the detected root pins it: resolution no longer depends
      // on the Drive mount being up at hook time.
      const config: AppConfig = {
        ...existing,
        ...(detectedRoot && answers.useDetectedRoot
          ? { dataRoot: detectedRoot }
          : {}),
      };

      await this.configManager.saveConfig(config);
      spinner.text = "Config saved...";

      if (installClaude) {
        await this.addHookToSettings();
      }
      if (installCodex) {
        await this.addCodexHooks();
      }
      spinner.text = "Hooks installed...";

      spinner.succeed("Setup complete!");

      if (installClaude) {
        console.log(chalk.green("\n✓ Claude SessionEnd hook installed"));
      }
      if (installCodex) {
        console.log(chalk.green("\n✓ Codex Stop + SubagentStop hooks installed"));
        console.log(
          chalk.gray("  Behavior: silent per-turn usage updates"),
        );
        console.log(
          chalk.gray("  In Codex, run /hooks once and trust the new hooks"),
        );
      }
      console.log(
        chalk.gray(`  Config file: ${this.configManager.getConfigPath()}\n`),
      );

      const effectiveRoot = resolveUsageRoot(config).root;
      console.log(chalk.cyan(`  Data root: ${effectiveRoot}\n`));
    } catch (error) {
      spinner.fail("Setup failed");
      throw error;
    }
  }

  /** Uninstall the selected provider hooks. */
  private async uninstall(target: "claude" | "codex" | "all"): Promise<void> {
    const spinner = ora("Removing hook...").start();

    try {
      if (target === "claude" || target === "all") {
        await this.removeHookFromSettings();
      }
      if (target === "codex" || target === "all") {
        await this.removeCodexHooks();
      }
      spinner.succeed("Hooks removed!");

      console.log(chalk.green(`\n✓ ${this.targetLabel(target)} hooks uninstalled`));
      console.log(
        chalk.gray(
          '  Config file preserved. Use "config --reset" to reset it.\n',
        ),
      );
    } catch (error) {
      spinner.fail("Uninstall failed");
      throw error;
    }
  }

  /**
   * Add the SessionEnd hook to settings.json
   */
  private async addHookToSettings(): Promise<void> {
    // Ensure .claude directory exists
    const claudeDir = join(this.settingsPath, "..");
    if (!existsSync(claudeDir)) {
      await mkdir(claudeDir, { recursive: true });
    }

    // Read existing settings
    let settings: ClaudeSettings = {};

    if (existsSync(this.settingsPath)) {
      // Backup existing settings
      const backupPath = `${this.settingsPath}.backup`;
      const content = await readFile(this.settingsPath, "utf-8");
      await writeFile(backupPath, content, "utf-8");

      try {
        settings = JSON.parse(content);
      } catch {
        throw new Error(
          "Failed to parse existing settings.json. Please check the file format.",
        );
      }
    }

    // Initialize hooks if not present
    if (!settings.hooks) {
      settings.hooks = {};
    }

    if (!settings.hooks.SessionEnd) {
      settings.hooks.SessionEnd = [];
    }

    // Pin to this local checkout so changes are picked up without an npm
    // publish/install cycle. The wrapper path is rewritten as $HOME-relative
    // (with forward slashes) so the same settings.json works across machines
    // that mirror the repo at the same location under HOME.
    //
    // We point at bin/run-hook.sh rather than calling node directly: it
    // resolves node at run time (PATH → WinGet versioned dir → nvm), which
    // both fixes Windows hook shells with a stripped PATH and survives node
    // upgrades that would move a baked-in process.execPath.
    const wrapperPath = resolve(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
      "bin",
      "run-hook.sh",
    );
    const homeNorm = homeDir().replace(/\\/g, "/");
    const normalized = wrapperPath.replace(/\\/g, "/");
    const relPath =
      homeNorm && normalized.toLowerCase().startsWith(homeNorm.toLowerCase())
        ? "$HOME" + normalized.slice(homeNorm.length)
        : normalized;
    // The thin shim detaches before Claude Code tears down the hook process.
    const hookCommand = `"${relPath}" capture --detach --provider claude --quiet`;
    const existingHook = settings.hooks.SessionEnd.find((h) =>
      h.hooks.some((hook) => this.isOurCommand(hook.command)),
    );

    if (existingHook) {
      console.log(chalk.yellow("\n⚠ Hook already installed, updating..."));
      // Remove old hook
      settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
        (h) =>
          !h.hooks.some((hook) => this.isOurCommand(hook.command)),
      );
    }

    settings.hooks.SessionEnd.push({
      hooks: [
        {
          type: "command",
          command: hookCommand,
        },
      ],
    });

    // Write settings
    await writeFile(
      this.settingsPath,
      JSON.stringify(settings, null, 2),
      "utf-8",
    );
  }

  /**
   * Remove the SessionEnd hook from settings.json
   */
  private async removeHookFromSettings(): Promise<void> {
    if (!existsSync(this.settingsPath)) {
      return;
    }

    const content = await readFile(this.settingsPath, "utf-8");
    let settings: ClaudeSettings;

    try {
      settings = JSON.parse(content);
    } catch {
      throw new Error("Failed to parse settings.json");
    }

    if (!settings.hooks?.SessionEnd) {
      return;
    }

    // Remove our hook
    settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
      (h) => !h.hooks.some((hook) => this.isOurCommand(hook.command)),
    );

    // Remove SessionEnd array if empty
    if (settings.hooks.SessionEnd.length === 0) {
      delete settings.hooks.SessionEnd;
    }

    // Remove hooks object if empty
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    // Write settings
    await writeFile(
      this.settingsPath,
      JSON.stringify(settings, null, 2),
      "utf-8",
    );
  }

  /** Install silent, detached Codex updates. Stop is per turn, not per task. */
  private async addCodexHooks(): Promise<void> {
    const codexDir = join(this.codexHooksPath, "..");
    await mkdir(codexDir, { recursive: true });

    let config: CodexHooksFile = {};
    if (existsSync(this.codexHooksPath)) {
      const content = await readFile(this.codexHooksPath, "utf-8");
      await writeFile(`${this.codexHooksPath}.backup`, content, "utf-8");
      try {
        config = JSON.parse(content);
      } catch {
        throw new Error(
          "Failed to parse existing ~/.codex/hooks.json. Please check the file format.",
        );
      }
    }

    config.hooks ||= {};
    const { unixWrapper, windowsBin } = this.hookExecutablePaths();
    const args = "capture --detach --provider codex --quiet";
    const handler: CommandHook = {
      type: "command",
      command: `"${unixWrapper}" ${args}`,
      commandWindows: `node "${windowsBin}" ${args}`,
      timeout: 30,
      statusMessage: "Recording Codex usage",
    };

    for (const event of ["Stop", "SubagentStop"]) {
      config.hooks[event] = this.withoutOurCodexHook(config.hooks[event] || []);
      config.hooks[event].push({ hooks: [handler] });
    }

    await writeFile(
      this.codexHooksPath,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  private async removeCodexHooks(): Promise<void> {
    if (!existsSync(this.codexHooksPath)) return;

    const content = await readFile(this.codexHooksPath, "utf-8");
    let config: CodexHooksFile;
    try {
      config = JSON.parse(content);
    } catch {
      throw new Error("Failed to parse existing ~/.codex/hooks.json.");
    }
    if (!config.hooks) return;

    for (const event of ["Stop", "SubagentStop"]) {
      const remaining = this.withoutOurCodexHook(config.hooks[event] || []);
      if (remaining.length > 0) config.hooks[event] = remaining;
      else delete config.hooks[event];
    }
    if (Object.keys(config.hooks).length === 0) delete config.hooks;

    await writeFile(
      this.codexHooksPath,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  private withoutOurCodexHook(
    groups: Array<{ matcher?: string; hooks: CommandHook[] }>,
  ): Array<{ matcher?: string; hooks: CommandHook[] }> {
    return groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((hook) => {
          const commands = `${hook.command} ${hook.commandWindows || ""}`;
          return !(this.isOurCommand(commands) && commands.includes("--provider codex"));
        }),
      }))
      .filter((group) => group.hooks.length > 0);
  }

  private hookExecutablePaths(): {
    unixWrapper: string;
    windowsBin: string;
  } {
    const wrapperPath = resolve(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
      "bin",
      "run-hook.sh",
    );
    const binPath = resolve(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
      "bin",
      "agent-usage-stat.js",
    );
    const homeNorm = homeDir().replace(/\\/g, "/");
    const normalized = wrapperPath.replace(/\\/g, "/");
    const unixWrapper =
      homeNorm && normalized.toLowerCase().startsWith(homeNorm.toLowerCase())
        ? "$HOME" + normalized.slice(homeNorm.length)
        : normalized;
    return { unixWrapper, windowsBin: binPath };
  }

  private targetLabel(target: "claude" | "codex" | "all"): string {
    if (target === "claude") return "Claude SessionEnd";
    if (target === "codex") return "Codex Stop + SubagentStop";
    return "Claude and Codex";
  }

  /** Recognize this package's installed hooks. */
  private isOurCommand(command: string): boolean {
    return command.includes("agent-usage-stat");
  }
}
