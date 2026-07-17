#!/usr/bin/env node

import { Command } from "commander";

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
  .option("--no-sync", "Skip Codex rollout reconciliation")
  .action(async (options) => {
    if (options.sync !== false) {
      const { SyncCommand } = await import("./commands/sync.js");
      await new SyncCommand().execute({ quiet: true });
    }
    const { PortalCommand } = await import("./commands/portal.js");
    await new PortalCommand().execute(options);
  });

program
  .command("sync")
  .description("Reconcile local Codex turns into the usage logbook")
  .option("--quiet", "Suppress progress output")
  .action(async (options) => {
    const { SyncCommand } = await import("./commands/sync.js");
    await new SyncCommand().execute(options);
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
  .command("setup")
  .description("Choose a usage folder and connect installed agents")
  .option("--data-root <path>", "Use this usage-data folder without prompting")
  .option("--uninstall", "Remove Agent Usage Stat hooks")
  .action(async (options) => {
    const { SetupCommand } = await import("./commands/setup.js");
    await new SetupCommand().execute(options);
  });

if (process.argv.length === 2) process.argv.push("portal");

await program.parseAsync();
