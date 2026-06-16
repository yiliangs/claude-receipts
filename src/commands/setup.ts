import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import prompts from "prompts";
import ora from "ora";
import { ConfigManager } from "../core/config-manager.js";
import { homeDir } from "../utils/paths.js";
import type { ReceiptConfig } from "../types/config.js";

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

export interface SetupOptions {
  uninstall?: boolean;
}

export class SetupCommand {
  private configManager = new ConfigManager();
  private settingsPath: string;

  constructor() {
    this.settingsPath = join(homeDir(), ".claude", "settings.json");
  }

  async execute(options: SetupOptions): Promise<void> {
    console.log(chalk.cyan.bold("\nClaude Receipts Setup\n"));

    try {
      if (options.uninstall) {
        await this.uninstall();
      } else {
        await this.install();
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

  /**
   * Install the SessionEnd hook
   */
  private async install(): Promise<void> {
    // Prompt user for configuration
    const answers = await prompts([
      {
        type: "text",
        name: "location",
        message: "Default location (leave blank to auto-detect):",
        initial: "",
      },
      {
        type: "multiselect",
        name: "outputs",
        message: "Output formats for the SessionEnd hook:",
        choices: [
          { title: "HTML (opens in browser)", value: "html", selected: true },
          { title: "PNG image", value: "png", selected: true },
          { title: "PDF", value: "pdf", selected: true },
          { title: "Thermal printer", value: "printer" },
        ],
        hint: "- Space to select, Enter to confirm",
        instructions: false,
      },
    ]);

    // User cancelled
    if (answers.location === undefined || answers.outputs === undefined) {
      console.log(chalk.yellow("\nSetup cancelled"));
      return;
    }

    const outputs: string[] =
      answers.outputs.length > 0 ? answers.outputs : ["html"];

    const spinner = ora("Setting up hook...").start();

    try {
      // Create config
      const config: ReceiptConfig = {
        version: "1.0.0",
        location: answers.location || undefined,
      };

      await this.configManager.saveConfig(config);
      spinner.text = "Config saved...";

      // Modify settings.json
      await this.addHookToSettings(outputs);
      spinner.text = "Hook installed...";

      spinner.succeed("Setup complete!");

      console.log(chalk.green("\n✓ SessionEnd hook installed"));
      console.log(
        chalk.gray(`  Outputs: ${outputs.join(", ")}`),
      );
      console.log(
        chalk.gray(`  Config file: ${this.configManager.getConfigPath()}\n`),
      );

      const tips: string[] = [];
      if (outputs.includes("html")) {
        tips.push(
          "HTML receipts will open in your browser when you exit Claude Code sessions",
        );
      }
      if (outputs.includes("png")) {
        tips.push(
          "PNG images will be saved to ~/.claude-receipts/projects/<slug>.png",
        );
      }
      if (outputs.includes("pdf")) {
        tips.push(
          "PDFs will be saved to ~/.claude-receipts/projects/<slug>.pdf",
        );
      }
      if (outputs.includes("printer")) {
        tips.push(
          "Receipts will be sent to your thermal printer (configure with: claude-receipts config --set printer=<name>)",
        );
      }
      console.log(chalk.cyan(tips.join("\n") + "\n"));
    } catch (error) {
      spinner.fail("Setup failed");
      throw error;
    }
  }

  /**
   * Uninstall the SessionEnd hook
   */
  private async uninstall(): Promise<void> {
    const spinner = ora("Removing hook...").start();

    try {
      await this.removeHookFromSettings();
      spinner.succeed("Hook removed!");

      console.log(chalk.green("\n✓ SessionEnd hook uninstalled"));
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
  private async addHookToSettings(outputs: string[]): Promise<void> {
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
    // --detach makes the hook a thin shim: read stdin, spawn a detached
    // worker, exit in <100ms. Without it, Claude Code's process-tree
    // teardown on /exit (and shortened kill timer on /clear) truncates the
    // hook mid-render — png/pdf almost always lost, occasionally even
    // the usage log entry.
    const hookCommand = `"${relPath}" generate --detach`;
    const existingHook = settings.hooks.SessionEnd.find((h) =>
      h.hooks.some((hook) => hook.command.includes("claude-receipts")),
    );

    if (existingHook) {
      console.log(chalk.yellow("\n⚠ Hook already installed, updating..."));
      // Remove old hook
      settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
        (h) =>
          !h.hooks.some((hook) => hook.command.includes("claude-receipts")),
      );
    }

    // Add our hook
    const outputArg = outputs.join(",");
    settings.hooks.SessionEnd.push({
      hooks: [
        {
          type: "command",
          command: `${hookCommand} --output ${outputArg}`,
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
      throw new Error("settings.json not found. Hook may not be installed.");
    }

    const content = await readFile(this.settingsPath, "utf-8");
    let settings: ClaudeSettings;

    try {
      settings = JSON.parse(content);
    } catch {
      throw new Error("Failed to parse settings.json");
    }

    if (!settings.hooks?.SessionEnd) {
      throw new Error("No SessionEnd hooks found in settings.json");
    }

    // Remove our hook
    settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
      (h) => !h.hooks.some((hook) => hook.command.includes("claude-receipts")),
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
}
