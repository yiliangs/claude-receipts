import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { spawnSync } from "child_process";
import { join, resolve } from "path";
import chalk from "chalk";
import prompts from "prompts";
import ora from "ora";
import { ConfigManager } from "../core/config-manager.js";
import { expandHome, homeDir } from "../utils/paths.js";
import { resolveUsageRoot } from "../utils/usage-root.js";
import {
  detectShellProfile,
  installTerminalWrappers,
  removeTerminalWrappers,
} from "../core/terminal-wrappers.js";
import {
  installClaudeHook,
  removeClaudeHook,
} from "../integrations/claude-hooks.js";
import {
  installCodexHooks,
  removeCodexHooks,
} from "../integrations/codex-hooks.js";
import { hookExecutablePaths } from "../integrations/hook-command.js";
import type { AppConfig } from "../types/config.js";
import type { ProviderName } from "../types/provider.js";

export interface SetupOptions {
  uninstall?: boolean;
  dataRoot?: string;
  terminalMessage?: boolean;
}

export function detectInstalledAgents(
  home = homeDir(),
  commandExists: (command: string) => boolean = hasCommand,
  environment: NodeJS.ProcessEnv = process.env,
): ProviderName[] {
  const agents: ProviderName[] = [];
  const claudeHome = environment.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const codexHome = environment.CODEX_HOME || join(home, ".codex");
  if (existsSync(claudeHome) || commandExists("claude")) {
    agents.push("claude");
  }
  if (existsSync(codexHome) || commandExists("codex")) {
    agents.push("codex");
  }
  return agents;
}

export class SetupCommand {
  private configManager = new ConfigManager();
  private settingsPath: string;
  private codexHooksPath: string;

  constructor() {
    const claudeHome =
      process.env.CLAUDE_CONFIG_DIR || join(homeDir(), ".claude");
    const codexHome = process.env.CODEX_HOME || join(homeDir(), ".codex");
    this.settingsPath = join(claudeHome, "settings.json");
    this.codexHooksPath = join(codexHome, "hooks.json");
  }

  async execute(options: SetupOptions): Promise<void> {
    console.log(chalk.cyan.bold("\nAgent Usage Stat Setup\n"));

    try {
      this.assertSupportedPlatform();
      if (options.uninstall) {
        await this.uninstall();
      } else {
        await this.install(options.dataRoot, options.terminalMessage !== false);
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

  /** Detect installed agents, choose one data directory, and install hooks. */
  private async install(
    dataRootOption?: string,
    terminalMessage = true,
  ): Promise<void> {
    const agents = detectInstalledAgents();
    if (agents.length === 0) {
      throw new Error(
        "No supported agent was found. Install Claude Code or Codex, run it once, then initialize again.",
      );
    }

    const existing = await this.configManager.loadConfig();
    const suggestedRoot = resolveUsageRoot(existing).root;
    const answers = dataRootOption
      ? { dataRoot: dataRootOption }
      : existing.dataRoot
        ? { dataRoot: existing.dataRoot }
        : await prompts({
          type: "text",
          name: "dataRoot",
          message: "Usage data folder",
          initial: suggestedRoot,
          validate: (value: string) =>
            value.trim() ? true : "Choose a folder for usage data",
        });

    if (!answers.dataRoot) {
      console.log(chalk.yellow("\nSetup cancelled"));
      return;
    }

    const dataRoot = resolve(expandHome(String(answers.dataRoot).trim()));
    const labels = agents.map(this.agentLabel).join(", ");
    console.log(chalk.gray(`Detected: ${labels}`));

    const spinner = ora("Connecting installed agents...").start();

    try {
      let codexNeedsTrust = false;
      let terminalProfile: string | undefined;
      let terminalWarning: string | undefined;
      const config: AppConfig = {
        ...existing,
        dataRoot,
      };

      await mkdir(join(dataRoot, "logbook.d"), { recursive: true });
      await this.configManager.saveConfig(config);
      spinner.text = "Usage folder ready...";

      if (agents.includes("claude")) {
        await installClaudeHook(this.settingsPath);
      }
      if (agents.includes("codex")) {
        codexNeedsTrust = await installCodexHooks(this.codexHooksPath);
      }
      spinner.text = "Agent hooks installed...";

      const terminal = await this.configureTerminalMessage(terminalMessage);
      terminalProfile = terminal.profile;
      terminalWarning = terminal.warning;

      spinner.succeed("Initialization complete");

      if (agents.includes("claude")) {
        console.log(chalk.green("\nClaude Code connected"));
      }
      if (agents.includes("codex")) {
        console.log(chalk.green("\nCodex connected"));
        if (codexNeedsTrust) {
          console.log(
            chalk.yellow(
              "Codex security requires one final action: open /hooks and trust the new hook.",
            ),
          );
        }
      }
      if (terminalProfile) {
        const action = terminalMessage ? "enabled" : "disabled";
        console.log(
          chalk.green(`\nSame-terminal usage message ${action}: ${terminalProfile}`),
        );
        if (terminalMessage) {
          console.log(chalk.gray("Open a new terminal for the command wrappers."));
        }
      }
      if (terminalWarning) {
        console.log(chalk.yellow(`\nTerminal message setup skipped: ${terminalWarning}`));
      }
      console.log(chalk.cyan(`\nUsage data: ${dataRoot}\n`));
    } catch (error) {
      spinner.fail("Setup failed");
      throw error;
    }
  }

  /** Remove this package's hooks from both supported agents. */
  private async uninstall(): Promise<void> {
    const spinner = ora("Removing agent hooks...").start();

    try {
      await removeClaudeHook(this.settingsPath);
      await removeCodexHooks(this.codexHooksPath);
      const terminal = await this.configureTerminalMessage(false);
      spinner.succeed("Agent hooks removed");

      if (terminal.profile) {
        console.log(
          chalk.gray(`  Terminal wrappers removed from ${terminal.profile}.`),
        );
      }
      if (terminal.warning) {
        console.log(
          chalk.yellow(`  Terminal wrapper cleanup skipped: ${terminal.warning}`),
        );
      }
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

  private async configureTerminalMessage(
    enabled: boolean,
  ): Promise<{ profile?: string; warning?: string }> {
    const profile = detectShellProfile();
    if (!profile) {
      return { warning: "no supported PowerShell, zsh, or bash profile was found" };
    }

    try {
      if (enabled) {
        const { windowsBin } = hookExecutablePaths();
        await installTerminalWrappers(profile, windowsBin);
      } else {
        await removeTerminalWrappers(profile);
      }
      return { profile: profile.path };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return { warning: message };
    }
  }

  private assertSupportedPlatform(): void {
    if (process.platform !== "win32" && process.platform !== "darwin") {
      throw new Error("Initialization supports Windows and macOS only.");
    }
  }

  private agentLabel(agent: ProviderName): string {
    return agent === "claude" ? "Claude Code" : "Codex";
  }
}

function hasCommand(command: string): boolean {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(locator, [command], {
    stdio: "ignore",
    timeout: 1500,
    windowsHide: true,
  }).status === 0;
}
