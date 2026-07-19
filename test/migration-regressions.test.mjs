import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ConfigManager } from "../dist/core/config-manager.js";
import { summarizeSpend } from "../dist/core/spend-summary.js";
import {
  isManagedUsageCommand,
  withoutManagedHookGroups,
} from "../dist/commands/setup.js";
import { resolveUsageRoot } from "../dist/utils/usage-root.js";
import { utcCalendarWindow } from "../dist/utils/utc-window.js";

const repoRoot = process.cwd();
const cliPath = join(repoRoot, "bin", "agent-usage-stat.js");

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function isolatedEnv(home) {
  return { ...process.env, HOME: home, USERPROFILE: home };
}

async function writeShard(root, name, data) {
  const directory = join(root, "logbook.d");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), JSON.stringify(data), "utf8");
}

async function waitForFile(path, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${path}`);
}

test("UTC calendar window preserves the portal cutoff semantics", () => {
  const anchor = Date.parse("2024-03-01T12:34:56.000Z");
  const window = utcCalendarWindow(anchor, 1);
  assert.equal(new Date(window.startMs).toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(window.endMs, anchor);
});

test("spend summary uses top-level costs and isolates malformed shards", async () => {
  const root = await mkdtemp(join(tmpdir(), "spend-summary-"));
  const anchor = Date.parse("2026-07-18T12:00:00.000Z");
  const cutoff = utcCalendarWindow(anchor, 30).startMs;
  try {
    await writeShard(root, "cutoff", {
      end_time: new Date(cutoff).toISOString(),
      total_cost_usd: 100,
      turns: [{ total_cost_usd: 60 }, { total_cost_usd: 40 }],
    });
    await writeShard(root, "fallback", {
      end_time: "invalid",
      start_time: "2026-07-01T00:00:00.000Z",
      total_cost_usd: 2.25,
    });
    await writeShard(root, "before", {
      end_time: new Date(cutoff - 1).toISOString(),
      total_cost_usd: 500,
    });
    await writeShard(root, "future", {
      end_time: new Date(anchor + 1).toISOString(),
      total_cost_usd: 500,
    });
    await writeShard(root, "coerced-zero", {
      end_time: "2026-07-01T00:00:00.000Z",
      total_cost_usd: null,
    });
    await writeFile(join(root, "logbook.d", "broken.json"), "{", "utf8");
    await writeFile(join(root, "logbook.csv"), "total_cost_usd\n99999\n", "utf8");

    const summary = await summarizeSpend({ root, days: 30, anchorMs: anchor });
    assert.equal(summary.totalCostUsd, 102.25);
    assert.equal(summary.roundedDollars, 102);
    assert.equal(summary.includedShards, 2);
    assert.equal(summary.skippedShards, 2);
    assert.equal(summary.scannedShards, 6);
    await assert.rejects(
      () => summarizeSpend({ root, days: 30, anchorMs: anchor, strict: true }),
      /Cannot produce a complete spend summary/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spend summary fails when the canonical shard directory is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "spend-missing-"));
  try {
    await assert.rejects(() => summarizeSpend({ root, days: 30 }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root resolution honors config and current/legacy precedence", async () => {
  const base = await mkdtemp(join(tmpdir(), "root-order-"));
  const mount = join(base, "mount");
  const newLocal = join(base, "new-local");
  const transitionalLocal = join(base, "transitional-local");
  const legacyLocal = join(base, "legacy-local");
  try {
    await mkdir(join(mount, "agent-usage-stat", "logbook.d"), { recursive: true });
    await mkdir(join(mount, "claude-receipts", "logbook.d"), { recursive: true });
    await mkdir(join(newLocal, "logbook.d"), { recursive: true });
    await mkdir(join(transitionalLocal, "logbook.d"), { recursive: true });
    await mkdir(join(legacyLocal, "logbook.d"), { recursive: true });

    const options = {
      mounts: [mount],
      newLocalRoot: newLocal,
      transitionalLocalRoot: transitionalLocal,
      legacyLocalRoot: legacyLocal,
    };
    assert.deepEqual(resolveUsageRoot({ dataRoot: join(base, "missing-config") }, options), {
      root: join(base, "missing-config"), source: "config",
    });
    assert.deepEqual(resolveUsageRoot({ legacyReceiptsRoot: join(base, "legacy-config") }, options), {
      root: join(base, "legacy-config"), source: "legacy-config",
    });
    assert.equal(resolveUsageRoot({}, options).source, "new-shared");

    await rm(join(mount, "agent-usage-stat"), { recursive: true, force: true });
    assert.equal(resolveUsageRoot({}, options).source, "legacy-shared");
    await rm(join(mount, "claude-receipts"), { recursive: true, force: true });
    assert.equal(resolveUsageRoot({}, options).source, "new-local");
    await rm(newLocal, { recursive: true, force: true });
    assert.equal(resolveUsageRoot({}, options).source, "transitional-local");
    await rm(transitionalLocal, { recursive: true, force: true });
    assert.equal(resolveUsageRoot({}, options).source, "legacy-local");
    await rm(legacyLocal, { recursive: true, force: true });
    assert.deepEqual(resolveUsageRoot({}, options), { root: newLocal, source: "default" });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("legacy config maps into v2 without modifying the legacy file", async () => {
  const home = await mkdtemp(join(tmpdir(), "legacy-config-"));
  const currentPath = join(home, ".agent-usage-stat.config.json");
  const legacyPath = join(home, ".claude-receipts.config.json");
  try {
    const legacyContent = JSON.stringify({ version: "1.0.0", receiptsRoot: "~/legacy-data" }, null, 2);
    await writeFile(legacyPath, legacyContent, "utf8");
    const manager = new ConfigManager(currentPath, legacyPath);
    assert.deepEqual(await manager.loadConfig(), {
      version: "2.0.0",
      dataRoot: "~/legacy-data",
    });
    assert.equal(existsSync(currentPath), false);

    await manager.saveConfig(await manager.loadConfig());
    assert.deepEqual(JSON.parse(await readFile(currentPath, "utf8")), {
      version: "2.0.0",
      dataRoot: "~/legacy-data",
    });
    assert.equal(await readFile(legacyPath, "utf8"), legacyContent);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("v2 config presence is authoritative and malformed config fails loudly", async () => {
  const home = await mkdtemp(join(tmpdir(), "v2-config-authority-"));
  const currentPath = join(home, ".agent-usage-stat.config.json");
  const legacyPath = join(home, ".claude-receipts.config.json");
  try {
    await writeFile(legacyPath, JSON.stringify({ receiptsRoot: "~/legacy-data" }), "utf8");
    await writeFile(currentPath, JSON.stringify({ version: "2.0.0" }), "utf8");
    const manager = new ConfigManager(currentPath, legacyPath);
    assert.deepEqual(await manager.loadConfig(), { version: "2.0.0" });

    for (const invalid of [null, [], "root", 7, { dataRoot: 42 }, { dataRoot: "" }]) {
      await writeFile(currentPath, JSON.stringify(invalid), "utf8");
      await assert.rejects(
        () => manager.loadConfig(),
        /Failed to parse usage config/,
      );
    }

    await writeFile(currentPath, "null", "utf8");
    const structuralSpend = runNode([cliPath, "spend", "--format", "raw"], {
      env: isolatedEnv(home),
    });
    assert.equal(structuralSpend.status, 1);
    assert.equal(structuralSpend.stdout, "");
    assert.match(structuralSpend.stderr, /Failed to parse usage config/);

    await writeFile(currentPath, "{", "utf8");
    await assert.rejects(() => manager.loadConfig(), /Failed to parse usage config/);
    const spend = runNode([cliPath, "spend", "--format", "raw"], {
      env: isolatedEnv(home),
    });
    assert.equal(spend.status, 1);
    assert.equal(spend.stdout, "");
    assert.match(spend.stderr, /Failed to parse usage config/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("managed hook filtering preserves unrelated hooks in the same group", () => {
  const fieldnotes = { type: "command", command: "fieldnotes capture" };
  const legacy = {
    type: "command",
    command: '"$HOME/source/repos/claude-receipts/bin/run-hook.sh" generate --detach --output html',
  };
  const current = {
    type: "command",
    command: '"$HOME/source/repos/claude-receipts/bin/run-hook.sh" capture --detach --provider claude --quiet',
  };
  const providerless = {
    type: "command",
    command: "agent-usage-stat capture --detach --quiet",
  };
  const codex = {
    type: "command",
    command: "agent-usage-stat capture --detach --provider codex --quiet",
  };
  assert.equal(isManagedUsageCommand(legacy.command), true);
  assert.equal(isManagedUsageCommand(current.command), true);
  assert.equal(isManagedUsageCommand(providerless.command), true);
  assert.deepEqual(
    withoutManagedHookGroups(
      [{ matcher: "", hooks: [fieldnotes, legacy, current, providerless, codex] }],
      "claude",
    ),
    [{ matcher: "", hooks: [fieldnotes, codex] }],
  );
});

test("setup migrates the legacy Claude hook once and preserves fieldnotes", async () => {
  const home = await mkdtemp(join(tmpdir(), "setup-migration-"));
  const claudeDir = join(home, ".claude");
  const dataRoot = join(home, "usage-data");
  const settingsPath = join(claudeDir, "settings.json");
  const env = isolatedEnv(home);
  try {
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      join(home, ".agent-usage-stat.config.json"),
      JSON.stringify({ version: "2.0.0", dataRoot }),
      "utf8",
    );
    const originalSettings = JSON.stringify({
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: "fieldnotes capture" }] },
          { hooks: [{ type: "command", command: "npx claude-receipts@latest generate --output html" }] },
          { hooks: [{ type: "command", command: "agent-usage-stat capture --detach --quiet" }] },
        ],
      },
    }, null, 2) + "\n";
    await writeFile(settingsPath, originalSettings, "utf8");

    const first = runNode([cliPath, "setup", "--provider", "claude"], { env });
    assert.equal(first.status, 0, first.stderr);
    const once = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(once);
    const commands = parsed.hooks.SessionEnd.flatMap((group) => group.hooks.map((hook) => hook.command));
    assert.ok(commands.includes("fieldnotes capture"));
    assert.equal(commands.filter((command) => command.includes("capture --detach --provider claude --quiet")).length, 1);
    assert.equal(commands.some((command) => command.includes(" generate")), false);
    assert.equal(commands.some((command) => command.includes("capture --detach --quiet")), false);
    assert.equal(parsed.hooks.SessionEnd.flatMap((group) => group.hooks).some((hook) => hook.async === true), false);
    const firstBackups = (await readdir(claudeDir)).filter((name) =>
      name.startsWith("settings.json.backup-"));
    assert.equal(firstBackups.length, 1);
    assert.equal(await readFile(join(claudeDir, firstBackups[0]), "utf8"), originalSettings);

    const second = runNode([cliPath, "setup", "--provider", "claude"], { env });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(settingsPath, "utf8"), once);
    const secondBackups = (await readdir(claudeDir)).filter((name) =>
      name.startsWith("settings.json.backup-"));
    assert.equal(secondBackups.length, 2);

    const uninstall = runNode([cliPath, "setup", "--provider", "claude", "--uninstall"], { env });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    const remaining = JSON.parse(await readFile(settingsPath, "utf8"));
    const remainingCommands = remaining.hooks.SessionEnd.flatMap((group) => group.hooks.map((hook) => hook.command));
    assert.deepEqual(remainingCommands, ["fieldnotes capture"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("spend CLI emits clean raw, rounded, and JSON output", async () => {
  const home = await mkdtemp(join(tmpdir(), "spend-cli-"));
  const dataRoot = join(home, "usage-data");
  const env = isolatedEnv(home);
  try {
    await writeFile(
      join(home, ".agent-usage-stat.config.json"),
      JSON.stringify({ version: "2.0.0", dataRoot }),
      "utf8",
    );
    await writeShard(dataRoot, "one", {
      end_time: new Date().toISOString(),
      total_cost_usd: 1234.6,
    });

    const raw = runNode([cliPath, "spend", "--days", "30", "--format", "raw"], { env });
    assert.equal(raw.status, 0, raw.stderr);
    assert.equal(raw.stdout, "1234.600000\n");

    const rounded = runNode([cliPath, "spend", "--days", "30", "--format", "rounded"], { env });
    assert.equal(rounded.status, 0, rounded.stderr);
    assert.equal(rounded.stdout, "1235\n");

    const json = runNode([cliPath, "spend", "--days", "30", "--format", "json"], { env });
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).totalCostUsd, 1234.6);

    await writeFile(join(dataRoot, "logbook.d", "broken.json"), "{", "utf8");
    const strict = runNode([
      cliPath,
      "spend",
      "--days",
      "30",
      "--format",
      "rounded",
      "--strict",
    ], { env });
    assert.equal(strict.status, 1);
    assert.equal(strict.stdout, "");
    assert.match(strict.stderr, /Cannot produce a complete spend summary/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("legacy generate invocation and executable alias each write one quiet shard", async () => {
  const home = await mkdtemp(join(tmpdir(), "legacy-cli-"));
  const dataRoot = join(home, "usage-data");
  const env = {
    ...isolatedEnv(home),
    AGENT_USAGE_STAT_ALL_SESSIONS: "1",
  };
  try {
    await writeFile(
      join(home, ".agent-usage-stat.config.json"),
      JSON.stringify({ version: "2.0.0", dataRoot }),
      "utf8",
    );

    const executables = [cliPath, join(repoRoot, "bin", "claude-receipts.js")];
    for (let index = 0; index < executables.length; index++) {
      const sessionId = `legacy-session-${index}`;
      const transcript = join(home, `${sessionId}.jsonl`);
      await writeFile(
        transcript,
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-07-18T00:00:00.000Z",
          cwd: home,
          message: {
            id: `response-${index}`,
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "done" }],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        }),
        "utf8",
      );

      const result = runNode([
        executables[index],
        "generate",
        "--detach",
        "-o",
        "html",
        "png",
        "pdf",
        "-l",
        "Chicago",
      ], {
        env,
        input: JSON.stringify({
          session_id: sessionId,
          transcript_path: transcript,
          cwd: home,
          hook_event_name: "SessionEnd",
        }),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");

      const shardPath = join(dataRoot, "logbook.d", `${sessionId}.json`);
      await waitForFile(shardPath);
      const shard = JSON.parse(await readFile(shardPath, "utf8"));
      assert.equal(shard.provider, "claude");
      assert.equal(shard.session_id, sessionId);
      assert.ok(shard.total_tokens > 0);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CSV migration writes Claude shards only when explicitly applied", async () => {
  const root = await mkdtemp(join(tmpdir(), "csv-migration-"));
  try {
    const header = [
      "timestamp", "session_slug", "session_id", "project", "branch", "cwd", "machine", "location",
      "start_time", "end_time", "duration_seconds", "duration_human", "input_tokens", "output_tokens",
      "cache_creation_tokens", "cache_read_tokens", "total_tokens", "total_cost_usd", "models",
    ].join(",");
    const row = [
      "2026-07-01", "legacy", "legacy-session", "project", "main", "cwd", "machine", "location",
      "2026-07-01T00:00:00Z", "2026-07-01T00:01:00Z", "60", "1m", "10", "5", "0", "0", "15", "1.25", "claude-sonnet-5",
    ].join(",");
    await writeFile(join(root, "logbook.csv"), `${header}\n${row}\n`, "utf8");

    const result = runNode([join(repoRoot, "scripts", "migrate-csv-to-shards.mjs"), `--root=${root}`, "--apply"]);
    assert.equal(result.status, 0, result.stderr);
    const shard = JSON.parse(await readFile(join(root, "logbook.d", "legacy-session.json"), "utf8"));
    assert.equal(shard.provider, "claude");
    assert.equal(shard.total_cost_usd, 1.25);
    assert.equal(existsSync(join(root, "logbook.csv")), false);
    const backups = (await readdir(root)).filter((name) =>
      name.startsWith("logbook.csv.migrated-") && name.endsWith(".bak"));
    assert.equal(backups.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CSV migration discovers the transitional local root without config", async () => {
  const home = await mkdtemp(join(tmpdir(), "csv-transitional-root-"));
  const root = join(home, ".agent-usage-stat", "projects");
  try {
    await mkdir(root, { recursive: true });
    const header = "timestamp,session_slug,session_id,project,branch,cwd,machine,location,start_time,end_time,duration_seconds,duration_human,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,total_tokens,total_cost_usd,models";
    const row = "2026-07-01,legacy,transitional-session,project,main,cwd,machine,location,2026-07-01T00:00:00Z,2026-07-01T00:01:00Z,60,1m,10,5,0,0,15,1.25,claude-sonnet-5";
    await writeFile(join(root, "logbook.csv"), `${header}\n${row}\n`, "utf8");

    const result = runNode([join(repoRoot, "scripts", "migrate-csv-to-shards.mjs")], {
      env: isolatedEnv(home),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY RUN: 1 rows -> shards/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("CSV migration refuses to overwrite a corrupt matching shard", async () => {
  const root = await mkdtemp(join(tmpdir(), "csv-corrupt-shard-"));
  try {
    const header = [
      "timestamp", "session_slug", "session_id", "project", "branch", "cwd", "machine", "location",
      "start_time", "end_time", "duration_seconds", "duration_human", "input_tokens", "output_tokens",
      "cache_creation_tokens", "cache_read_tokens", "total_tokens", "total_cost_usd", "models",
    ].join(",");
    const row = [
      "2026-07-01", "legacy", "corrupt-session", "project", "main", "cwd", "machine", "location",
      "2026-07-01T00:00:00Z", "2026-07-01T00:01:00Z", "60", "1m", "10", "5", "0", "0", "15", "9.99", "claude-sonnet-5",
    ].join(",");
    await writeFile(join(root, "logbook.csv"), `${header}\n${row}\n`, "utf8");
    await mkdir(join(root, "logbook.d"), { recursive: true });
    await writeFile(join(root, "logbook.d", "corrupt-session.json"), "{", "utf8");

    const result = runNode([join(repoRoot, "scripts", "migrate-csv-to-shards.mjs"), `--root=${root}`, "--apply"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /require explicit reconciliation/);
    assert.equal(await readFile(join(root, "logbook.d", "corrupt-session.json"), "utf8"), "{");
    assert.equal(existsSync(join(root, "logbook.csv")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CSV migration refuses retirement when an unrelated corrupt shard remains", async () => {
  const root = await mkdtemp(join(tmpdir(), "csv-unmatched-corrupt-"));
  try {
    const header = "timestamp,session_slug,session_id,project,branch,cwd,machine,location,start_time,end_time,duration_seconds,duration_human,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,total_tokens,total_cost_usd,models";
    const row = "2026-07-01,legacy,valid-session,project,main,cwd,machine,location,2026-07-01T00:00:00Z,2026-07-01T00:01:00Z,60,1m,10,5,0,0,15,1.25,claude-sonnet-5";
    await writeFile(join(root, "logbook.csv"), `${header}\n${row}\n`, "utf8");
    await mkdir(join(root, "logbook.d"), { recursive: true });
    await writeFile(join(root, "logbook.d", "orphan.json"), "{", "utf8");

    const result = runNode([join(repoRoot, "scripts", "migrate-csv-to-shards.mjs"), `--root=${root}`, "--apply"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /require explicit reconciliation/);
    assert.equal(existsSync(join(root, "logbook.csv")), true);
    assert.equal(existsSync(join(root, "logbook.d", "valid-session.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CSV migration validates every row before writing anything", async () => {
  const root = await mkdtemp(join(tmpdir(), "csv-invalid-row-"));
  try {
    const header = "timestamp,session_slug,session_id,project,branch,cwd,machine,location,start_time,end_time,duration_seconds,duration_human,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,total_tokens,total_cost_usd,models";
    const valid = "2026-07-01,legacy,valid-session,project,main,cwd,machine,location,2026-07-01T00:00:00Z,2026-07-01T00:01:00Z,60,1m,10,5,0,0,15,1.25,claude-sonnet-5";
    const invalid = "2026-07-01,legacy,invalid-session,project,main,cwd,machine,location,not-a-date,2026-07-01T00:01:00Z,60,1m,10,5,0,0,15,not-a-cost,claude-sonnet-5";
    await writeFile(join(root, "logbook.csv"), `${header}\n${valid}\n${invalid}\n`, "utf8");

    const result = runNode([
      join(repoRoot, "scripts", "migrate-csv-to-shards.mjs"),
      `--root=${root}`,
      "--apply",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CSV validation error/);
    assert.equal(existsSync(join(root, "logbook.csv")), true);
    assert.equal(existsSync(join(root, "logbook.d")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CSV migration refuses duplicate output identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "csv-duplicate-id-"));
  try {
    const header = "timestamp,session_slug,session_id,project,branch,cwd,machine,location,start_time,end_time,duration_seconds,duration_human,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,total_tokens,total_cost_usd,models";
    const lower = "2026-07-01,legacy,duplicate-session,project,main,cwd,machine,location,2026-07-01T00:00:00Z,2026-07-01T00:01:00Z,60,1m,10,5,0,0,15,1.25,claude-sonnet-5";
    const higher = "2026-07-01,legacy,duplicate-session,project,main,cwd,machine,location,2026-07-01T00:00:00Z,2026-07-01T00:02:00Z,120,2m,20,10,0,0,30,2.50,claude-sonnet-5";
    await writeFile(join(root, "logbook.csv"), `${header}\n${lower}\n${higher}\n`, "utf8");

    const result = runNode([
      join(repoRoot, "scripts", "migrate-csv-to-shards.mjs"),
      `--root=${root}`,
      "--apply",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /output collision/);
    assert.equal(existsSync(join(root, "logbook.csv")), true);
    assert.equal(existsSync(join(root, "logbook.d")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retired reconcile script refuses to mutate CSV data", () => {
  const result = runNode([join(repoRoot, "scripts", "reconcile-logbook.mjs"), "--apply"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /logbook\.d is the only usage source/);
});
