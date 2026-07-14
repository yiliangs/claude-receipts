import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { CodexProvider, detectProvider } from "../dist/index.js";
import { LogbookWriter } from "../dist/core/logbook-writer.js";

function line(type, payload, timestamp) {
  return JSON.stringify({ type, payload, timestamp });
}

test("Codex rollout usage is deduped, split by model, and long-context priced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-usage-stat-test-"));
  const path = join(
    dir,
    "rollout-2026-07-13T00-00-00-11111111-1111-1111-1111-111111111111.jsonl",
  );
  const cumulativeOne = {
    input_tokens: 1000,
    cached_input_tokens: 400,
    output_tokens: 100,
    total_tokens: 1100,
  };
  const cumulativeTwo = {
    input_tokens: 301000,
    cached_input_tokens: 200400,
    output_tokens: 1100,
    total_tokens: 302100,
  };
  await writeFile(
    path,
    [
      line(
        "session_meta",
        {
          id: "11111111-1111-1111-1111-111111111111",
          cwd: "C:\\work\\usage-stat",
          git: { branch: "main" },
        },
        "2026-07-13T00:00:00.000Z",
      ),
      line("turn_context", { model: "gpt-5.4" }, "2026-07-13T00:00:01.000Z"),
      line(
        "event_msg",
        { type: "user_message", message: "Build usage analytics" },
        "2026-07-13T00:00:02.000Z",
      ),
      line(
        "event_msg",
        {
          type: "token_count",
          info: {
            total_token_usage: cumulativeOne,
            last_token_usage: cumulativeOne,
          },
        },
        "2026-07-13T00:00:03.000Z",
      ),
      // Replay of the same cumulative event must not double bill.
      line(
        "event_msg",
        {
          type: "token_count",
          info: {
            total_token_usage: cumulativeOne,
            last_token_usage: cumulativeOne,
          },
        },
        "2026-07-13T00:00:03.500Z",
      ),
      line(
        "turn_context",
        { model: "gpt-5.6-sol" },
        "2026-07-13T00:00:04.000Z",
      ),
      line(
        "event_msg",
        {
          type: "token_count",
          info: {
            total_token_usage: cumulativeTwo,
            last_token_usage: {
              input_tokens: 300000,
              cached_input_tokens: 200000,
              output_tokens: 1000,
              total_tokens: 301000,
            },
          },
        },
        "2026-07-13T00:00:05.000Z",
      ),
      line(
        "event_msg",
        { type: "agent_message", message: "Done" },
        "2026-07-13T00:00:06.000Z",
      ),
    ].join("\n"),
    "utf8",
  );

  try {
    const provider = new CodexProvider();
    const usage = await provider.calculateUsage(path, "fallback");
    const transcript = await provider.parseTranscript(path, usage.sessionId);
    const detected = await detectProvider(path);

    assert.equal(detected.name, "codex");
    assert.equal(usage.sessionId, "11111111-1111-1111-1111-111111111111");
    assert.equal(usage.inputTokens, 100600);
    assert.equal(usage.cacheReadTokens, 200400);
    assert.equal(usage.outputTokens, 1100);
    assert.equal(usage.totalTokens, 302100);
    assert.equal(Number(usage.totalCost.toFixed(6)), 1.2481);
    assert.deepEqual(usage.modelsUsed, ["gpt-5.6-sol", "gpt-5.4"]);
    assert.deepEqual(provider.getUnknownModels(), []);
    assert.equal(transcript.sessionSlug, "build-usage-analytics");
    assert.equal(transcript.projectName, "usage-stat");
    assert.equal(transcript.gitBranch, "main");
    assert.equal(transcript.userMessageCount, 1);
    assert.equal(transcript.assistantMessageCount, 1);

  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logbook never regresses when detached workers finish out of order", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-logbook-test-"));
  const writer = new LogbookWriter();
  const makeData = (tokens, cost, end) => ({
    sessionData: {
      provider: "codex",
      sessionId: "22222222-2222-2222-2222-222222222222",
      inputTokens: tokens - 10,
      outputTokens: 10,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: tokens,
      totalCost: cost,
      modelsUsed: ["gpt-5.6-sol"],
      modelBreakdowns: [],
    },
    transcriptData: {
      sessionSlug: "race-test",
      firstPrompt: "race",
      startTime: new Date("2026-07-13T00:00:00.000Z"),
      endTime: new Date(end),
      userMessageCount: 1,
      assistantMessageCount: 1,
      totalMessages: 2,
      projectName: "usage-stat",
    },
  });

  try {
    const shard = await writer.append(
      root,
      makeData(1000, 1.5, "2026-07-13T00:10:00.000Z"),
    );
    await Promise.all(
      [900, 800, 700, 600, 500].map((tokens) =>
        writer.append(
          root,
          makeData(
            tokens,
            tokens / 1000,
            `2026-07-13T00:0${tokens / 100}:00.000Z`,
          ),
        ),
      ),
    );
    const record = JSON.parse(await readFile(shard, "utf8"));
    assert.equal(record.total_tokens, 1000);
    assert.equal(record.total_cost_usd, 1.5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detached Codex hook performs a quiet usage update", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-cli-test-"));
  const codexHome = join(home, ".codex");
  const sessionDir = join(codexHome, "sessions", "2026", "07", "13");
  const dataRoot = join(home, "usage-data");
  const sessionId = "33333333-3333-3333-3333-333333333333";
  const rollout = join(
    sessionDir,
    `rollout-2026-07-13T00-00-00-${sessionId}.jsonl`,
  );

  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(home, ".agent-usage-stat.config.json"),
    JSON.stringify({ version: "2.0.0", dataRoot }),
    "utf8",
  );
  await writeFile(
    rollout,
    [
      line(
        "session_meta",
        { id: sessionId, cwd: "C:\\work\\cli-test" },
        "2026-07-13T00:00:00.000Z",
      ),
      line("turn_context", { model: "gpt-5.4" }, "2026-07-13T00:00:01.000Z"),
      line(
        "event_msg",
        {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 500,
              output_tokens: 100,
              total_tokens: 1100,
            },
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 500,
              output_tokens: 100,
              total_tokens: 1100,
            },
          },
        },
        "2026-07-13T00:00:02.000Z",
      ),
    ].join("\n"),
    "utf8",
  );

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        join(process.cwd(), "bin", "agent-usage-stat.js"),
        "capture",
        "--detach",
        "--provider",
        "codex",
        "--quiet",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CODEX_HOME: codexHome,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(
        JSON.stringify({
          session_id: sessionId,
          transcript_path: rollout,
          cwd: "C:\\work\\cli-test",
          permission_mode: "default",
          hook_event_name: "Stop",
          model: "gpt-5.4",
          turn_id: "turn-1",
          stop_hook_active: false,
        }),
      );
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");

    const shardPath = join(dataRoot, "logbook.d", `${sessionId}.json`);
    let shard;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        shard = JSON.parse(await readFile(shardPath, "utf8"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(shard, "detached worker did not write its shard");
    assert.equal(shard.provider, "codex");
    assert.equal(shard.total_tokens, 1100);
    assert.equal(shard.total_cost_usd, 0.002875);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
