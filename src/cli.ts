#!/usr/bin/env node

import { Command, Option } from "commander";

// Command classes are imported lazily inside each action. generate.ts alone
// pulls in geoip-lite + date-fns + the renderer graph (~1.8s of module-load
// time). The SessionEnd hook's `generate --detach` shim must stay off that
// graph so it can spawn its worker before Claude Code's exit teardown kills it
// — so nothing heavy may be imported at the top of this file.

const program = new Command();

// Keep in sync with package.json.
program
  .name("claude-receipts")
  .description("Generate quirky receipts for your Claude Code usage")
  .version("1.1.0");

// Generate command
program
  .command("generate")
  .description("Generate a receipt for a Claude Code session")
  .option("-s, --session <id>", "Specific session ID to generate receipt for")
  .addOption(
    new Option("-o, --output <format...>", "Output format(s): html, png, pdf, console (comma-separated or repeated)")
      .argParser((value: string, prev: string[] | undefined) => {
        const formats = value.split(",").map((s) => s.trim()).filter(Boolean);
        const valid = ["html", "png", "pdf", "console"];
        for (const f of formats) {
          if (!valid.includes(f)) {
            throw new Error(`Invalid output format "${f}". Valid formats: ${valid.join(", ")}`);
          }
        }
        return [...(prev || []), ...formats];
      }),
  )
  .option("-l, --location <text>", "Override location detection")
  .option(
    "--detach",
    "Hook shim mode: read stdin, spawn a detached worker that does the actual work, exit immediately. Used in the SessionEnd hook so /clear and /exit can't kill mid-render children.",
  )
  .option(
    "--input-file <path>",
    "Read SessionEnd hook JSON from a file instead of stdin. Set automatically by --detach when respawning the worker; the worker deletes the file after reading.",
  )
  .action(async (options) => {
    // Detach shim: built-ins-only path, no heavy imports. Must stay fast so
    // the detached worker is spawned before Claude Code tears down the hook.
    if (options.detach) {
      const { runDetachShim } = await import("./commands/detach-shim.js");
      runDetachShim(options);
      return;
    }
    const { GenerateCommand } = await import("./commands/generate.js");
    await new GenerateCommand().execute(options);
  });

// Config command
program
  .command("config")
  .description("Manage configuration")
  .option("--show", "Display current configuration")
  .option("--set <key=value>", "Set a configuration value")
  .option("--reset", "Reset configuration to defaults")
  .action(async (options) => {
    const { ConfigCommand } = await import("./commands/config.js");
    await new ConfigCommand().execute(options);
  });

// Setup command
program
  .command("setup")
  .description("Setup automatic receipt generation via SessionEnd hook")
  .option("--uninstall", "Remove the SessionEnd hook")
  .action(async (options) => {
    const { SetupCommand } = await import("./commands/setup.js");
    await new SetupCommand().execute(options);
  });

// Make generate the default command if no command is specified
if (process.argv.length === 2) {
  process.argv.push("generate");
}

program.parse();
