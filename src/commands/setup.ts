import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
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
import type { AppConfig } from "../types/config.js";
import type { ProviderName } from "../types/provider.js";

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
        await this.addHookToSettings();
      }
      if (agents.includes("codex")) {
        codexNeedsTrust = await this.addCodexHooks();
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
      await this.removeHookFromSettings();
      await this.removeCodexHooks();
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
        const { windowsBin } = this.hookExecutablePaths();
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
    const hookCommand = `"${relPath}" capture --detach --quiet`;
    const existingHook = settings.hooks.SessionEnd.find((h) =>
      h.hooks.some((hook) => this.isOurCommand(hook.command)),
    );

    if (existingHook) {
      if (existingHook.hooks.some((hook) => hook.command === hookCommand)) {
        return;
      }
      console.log(chalk.yellow("\nClaude Code hook already installed; updating it."));
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
  private async addCodexHooks(): Promise<boolean> {
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
          "Failed to parse the existing Codex hooks file. Please check its format.",
        );
      }
    }

    config.hooks ||= {};
    const { unixWrapper, windowsBin } = this.hookExecutablePaths();
    const args = "capture --detach --quiet";
    const handler: CommandHook = {
      type: "command",
      command: `"${unixWrapper}" ${args}`,
      commandWindows: `node "${windowsBin}" ${args}`,
      timeout: 30,
      statusMessage: "Recording Codex usage",
    };
    const alreadyInstalled = ["Stop", "SubagentStop"].every((event) => {
      const ours = (config.hooks?.[event] || []).flatMap((group) =>
        group.hooks.filter((hook) =>
          this.isOurCommand(`${hook.command} ${hook.commandWindows || ""}`),
        ),
      );
      return (
        ours.length === 1 &&
        ours[0].command === handler.command &&
        ours[0].commandWindows === handler.commandWindows
      );
    });

    for (const event of ["Stop", "SubagentStop"]) {
      config.hooks[event] = this.withoutOurCodexHook(config.hooks[event] || []);
      config.hooks[event].push({ hooks: [handler] });
    }

    await writeFile(
      this.codexHooksPath,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
    return !alreadyInstalled;
  }

  private async removeCodexHooks(): Promise<void> {
    if (!existsSync(this.codexHooksPath)) return;

    const content = await readFile(this.codexHooksPath, "utf-8");
    let config: CodexHooksFile;
    try {
      config = JSON.parse(content);
    } catch {
      throw new Error("Failed to parse the existing Codex hooks file.");
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
          return !this.isOurCommand(commands);
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

  private assertSupportedPlatform(): void {
    if (process.platform !== "win32" && process.platform !== "darwin") {
      throw new Error("Initialization supports Windows and macOS only.");
    }
  }

  private agentLabel(agent: ProviderName): string {
    return agent === "claude" ? "Claude Code" : "Codex";
  }

  /** Recognize both the current package hook and hooks from its old name. */
  private isOurCommand(command: string): boolean {
    const normalized = command.replace(/\\/g, "/").toLowerCase();
    return (
      normalized.includes("agent-usage-stat") ||
      (normalized.includes("/bin/run-hook.sh") &&
        (normalized.includes(" capture") || normalized.includes(" generate")))
    );
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
