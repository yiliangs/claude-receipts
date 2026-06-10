import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { priceFor, normalizeModelId } from "./pricing.js";
import type { TranscriptMessage } from "../types/transcript.js";
import type { SessionUsage, ModelBreakdown } from "../types/session.js";

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
    const expanded = transcriptPath.replace(/^~/, process.env.HOME || "");
    if (!existsSync(expanded)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    const content = await readFile(expanded, "utf-8");
    const totalsByModel = new Map<string, ModelTotals>();
    // One assistant turn with N content blocks (text + tool_use…) is written
    // as N JSONL lines that share message.id + requestId and REPEAT the same
    // usage object — the usage is for the whole API response, not per block.
    // Summing every line multi-counts the same billing event (observed 3-5×,
    // ~3× cost inflation overall). Dedupe by message.id+requestId, matching
    // ccusage. Lines missing either id can't be deduped, so we count them.
    const seenBillingKeys = new Set<string>();

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

      const model = msg.message.model;
      // Synthetic messages aren't a real model — skip so they never reach the
      // breakdown, the receipt line items, or the logbook `models` column.
      if (model === SYNTHETIC_MODEL) continue;

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
