import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, basename } from "path";
import { priceFor, normalizeModelId } from "./pricing.js";
import { displayModelName } from "./model-names.js";
import { expandHome } from "../../utils/paths.js";
import type { TranscriptMessage } from "./transcript-format.js";
import type { SessionUsage, ModelBreakdown } from "../../types/session.js";

interface ModelTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Sentinel model id Claude Code writes for synthetic assistant messages
 * (interrupts, API-error placeholders, subagent/sidechain artifacts). These
 * are not a real billed model — including them pollutes the model breakdown
 * with a phantom "<synthetic>" entry carrying no real usage. ccusage skips
 * them too.
 */
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * Compute session usage and cost directly from the transcript JSONL.
 *
 * Replaces the ccusage subprocess: same shape on output, but reads the
 * file Claude Code itself just wrote — so it's instantaneous and never
 * suffers the index-lag race that forced the old retry loop. Pricing
 * comes from the in-repo table; unknown models bill at $0 and surface
 * via getUnknownModels() so the caller can log them.
 */
export class UsageCalculator {
  private unknownModels = new Set<string>();

  async calculate(
    transcriptPath: string,
    sessionId: string,
  ): Promise<SessionUsage> {
    const expanded = expandHome(transcriptPath);
    if (!existsSync(expanded)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    const totalsByModel = new Map<string, ModelTotals>();
    // One assistant turn with N content blocks (text + tool_use…) is written
    // as N JSONL lines that share message.id + requestId and REPEAT the same
    // usage object — the usage is for the whole API response, not per block.
    // Summing every line multi-counts the same billing event (observed 3-5×,
    // ~3× cost inflation overall). Dedupe by message.id+requestId, matching
    // ccusage. Lines missing either id can't be deduped, so we count them.
    // The set is shared across the main transcript and all subagent files —
    // a billing event must count exactly once no matter where it appears.
    const seenBillingKeys = new Set<string>();

    for (const file of await this.transcriptFiles(expanded, sessionId)) {
      await this.accumulateFile(file, totalsByModel, seenBillingKeys);
    }

    const breakdowns: ModelBreakdown[] = [];
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheCreate = 0;
    let totalCacheRead = 0;

    for (const [model, t] of totalsByModel) {
      const cost = this.costFor(model, t);
      totalCost += cost;
      totalInput += t.inputTokens;
      totalOutput += t.outputTokens;
      totalCacheCreate += t.cacheCreationTokens;
      totalCacheRead += t.cacheReadTokens;

      breakdowns.push({
        modelName: model,
        displayName: displayModelName(model),
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        cacheCreationTokens: t.cacheCreationTokens,
        cacheReadTokens: t.cacheReadTokens,
        cost,
      });
    }

    // Sort by cost desc so the dominant model heads the breakdown
    breakdowns.sort((a, b) => b.cost - a.cost);

    const totalTokens =
      totalInput + totalOutput + totalCacheCreate + totalCacheRead;

    return {
      provider: "claude",
      sessionId,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationTokens: totalCacheCreate,
      cacheReadTokens: totalCacheRead,
      totalTokens,
      totalCost,
      modelsUsed: breakdowns.map((b) => b.modelName),
      modelBreakdowns: breakdowns,
    };
  }

  /** Models priced at $0 because we have no entry — generate.ts logs these. */
  getUnknownModels(): string[] {
    return [...this.unknownModels];
  }

  /**
   * The main transcript plus any subagent transcripts. Claude Code writes
   * Task/Agent and workflow subagent usage to files under
   * `<projectDir>/<session-id>/subagents/` — their billing events never appear
   * in the main JSONL, so skipping them undercounts every session that
   * delegated work.
   *
   * The layout is NOT flat. Plain Task/Agent runs land directly in
   * `subagents/agent-*.jsonl`, but Workflow-spawned agents are nested another
   * two levels deep under `subagents/workflows/wf_<id>/agent-*.jsonl`. A
   * non-recursive scan sees only the flat case and silently drops every
   * workflow agent — on a heavy ultracode/workflow session that's ~half the
   * real spend (observed: a $223 session billed at $114). So we walk the
   * subagents tree recursively and take every *.jsonl at any depth.
   *
   * The subagent directory is usually under the same project dir as the main
   * transcript, but a run using isolation:'worktree' stores the parent
   * transcript under the repo's project dir while its subagents land under the
   * *worktree's* project dir — a sibling directory keyed to the worktree path.
   * So we look both next to the transcript and across every project dir,
   * matching on the session id. Missing directories just mean no subagents ran.
   */
  private async transcriptFiles(
    mainPath: string,
    sessionId: string,
  ): Promise<string[]> {
    const files = [mainPath];
    const sid = sessionId || basename(mainPath).replace(/\.jsonl$/, "");

    const projectDir = dirname(mainPath);
    const candidateDirs = new Set<string>([projectDir]);
    try {
      // ~/.claude/projects — sibling project dirs (covers the worktree split).
      const projectsRoot = dirname(projectDir);
      for (const entry of await readdir(projectsRoot)) {
        candidateDirs.add(join(projectsRoot, entry));
      }
    } catch {
      // mainPath isn't under the standard projects root — co-located only.
    }

    for (const dir of candidateDirs) {
      const subagentDir = join(dir, sid, "subagents");
      try {
        // Recursive: workflow agents nest under subagents/workflows/wf_*/.
        // readdir returns paths relative to subagentDir; directory entries
        // (e.g. "workflows") don't end in .jsonl, so they're skipped.
        for (const entry of await readdir(subagentDir, { recursive: true })) {
          if (entry.endsWith(".jsonl")) files.push(join(subagentDir, entry));
        }
      } catch {
        // no subagents directory here
      }
    }
    return files;
  }

  /**
   * Sum one JSONL file's billing events into totalsByModel, deduping against
   * the shared seenBillingKeys set.
   */
  private async accumulateFile(
    path: string,
    totalsByModel: Map<string, ModelTotals>,
    seenBillingKeys: Set<string>,
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(path, "utf-8");
    } catch {
      // Subagent file vanished or unreadable — skip rather than fail the receipt.
      return;
    }

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let msg: TranscriptMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (msg.type !== "assistant" || !msg.message?.usage || !msg.message.model)
        continue;

      // Synthetic messages aren't a real model — skip so they never reach the
      // breakdown, the receipt line items, or the logbook `models` column.
      if (msg.message.model === SYNTHETIC_MODEL) continue;

      // Aggregate by normalized alias so "claude-opus-4-8", a dated snapshot,
      // and "claude-opus-4-8[1m]" land in one breakdown row, not three.
      const model = normalizeModelId(msg.message.model);

      // Skip repeated lines of the same multi-block turn (see seenBillingKeys).
      const msgId = msg.message.id;
      const reqId = msg.requestId;
      if (msgId && reqId) {
        const key = `${msgId}:${reqId}`;
        if (seenBillingKeys.has(key)) continue;
        seenBillingKeys.add(key);
      }

      const u = msg.message.usage;

      const totals = totalsByModel.get(model) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      totals.inputTokens += u.input_tokens || 0;
      totals.outputTokens += u.output_tokens || 0;
      totals.cacheCreationTokens += u.cache_creation_input_tokens || 0;
      totals.cacheReadTokens += u.cache_read_input_tokens || 0;
      totalsByModel.set(model, totals);
    }
  }

  private costFor(model: string, t: ModelTotals): number {
    const p = priceFor(model);
    if (!p) {
      this.unknownModels.add(normalizeModelId(model));
      return 0;
    }
    return (
      (t.inputTokens * p.input +
        t.outputTokens * p.output +
        t.cacheCreationTokens * p.cacheWrite +
        t.cacheReadTokens * p.cacheRead) /
      1_000_000
    );
  }
}
