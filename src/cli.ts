#!/usr/bin/env node

import { Command, Option } from "commander";

// Commands are loaded lazily. The hook path must reach the detach shim without
// loading provider parsers, the portal server, or any other worker code.
const program = new Command();

program
  .name("agent-usage-stat")
  .description("Explore Claude Code and Codex usage in a local portal")
  .version("2.0.0");

program
  .command("capture")
  .description("Record one Claude Code or Codex session")
  .option("-s, --session <id>", "Specific session ID to record")
  .addOption(
    new Option("-p, --provider <provider>", "Session provider")
      .choices(["claude", "codex"]),
  )
  .option("--detach", "Spawn a detached capture worker and exit")
  .option("--input-file <path>", "Read hook JSON from a file")
  .option("--quiet", "Suppress console output")
  .action(async (options) => {
    if (options.detach) {
      const { runDetachShim } = await import("./commands/detach-shim.js");
      runDetachShim(options);
      return;
    }
    const { CaptureCommand } = await import("./commands/capture.js");
    await new CaptureCommand().execute(options);
  });

program
  .command("portal")
  .description("Open the local usage portal")
  .option("--port <number>", "Local server port", "4179")
  .option("--no-open", "Start without opening a browser")
  .action(async (options) => {
    const { PortalCommand } = await import("./commands/portal.js");
    await new PortalCommand().execute(options);
  });

program
  .command("config")
  .description("Show or change the data directory")
  .option("--show", "Display current configuration")
  .option("--set <key=value>", "Set a configuration value")
  .option("--reset", "Reset configuration to defaults")
  .action(async (options) => {
    const { ConfigCommand } = await import("./commands/config.js");
    await new ConfigCommand().execute(options);
  });

program
  .command("spend")
  .description("Summarize recorded spend over a UTC calendar window")
  .option("--days <number>", "Number of days to include", "30")
  .option("--strict", "Fail instead of returning a partial total")
  .addOption(
    new Option("--format <format>", "Output format")
      .choices(["human", "raw", "rounded", "json"])
      .default("human"),
  )
  .action(async (options) => {
    const { SpendCommand } = await import("./commands/spend.js");
    await new SpendCommand().execute(options);
  });

program
  .command("setup")
  .description("Connect Claude Code and/or Codex")
  .addOption(
    new Option("-p, --provider <provider>", "Hooks to configure")
      .choices(["claude", "codex", "all"])
      .default("all"),
  )
  .option("--uninstall", "Remove the selected integration(s)")
  .action(async (options) => {
    const { SetupCommand } = await import("./commands/setup.js");
    await new SetupCommand().execute(options);
  });

program
  .command("generate", { hidden: true })
  .description("Legacy compatibility alias for Claude usage capture")
  .option("-s, --session <id>", "Specific session ID to record")
  .option("--detach", "Spawn a detached capture worker and exit")
  .option("--input-file <path>", "Read hook JSON from a file")
  .option("-o, --output <formats...>", "Retired receipt output formats")
  .option("-l, --location <location>", "Retired receipt location")
  .option("--printer <printer>", "Retired receipt printer")
  .option("--quiet", "Suppress console output")
  .action(async (options) => {
    if (options.detach) {
      const { runDetachShim } = await import("./commands/detach-shim.js");
      runDetachShim({ provider: "claude", quiet: true });
      return;
    }
    if (!options.quiet) {
      console.error("generate is deprecated; use capture --provider claude");
    }
    const { CaptureCommand } = await import("./commands/capture.js");
    await new CaptureCommand().execute({
      session: options.session,
      inputFile: options.inputFile,
      provider: "claude",
      quiet: options.quiet,
    });
  });

if (process.argv.length === 2) process.argv.push("portal");

program.parse();
