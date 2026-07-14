import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { expandHome } from "../../utils/paths.js";
import {
  LONG_CONTEXT_THRESHOLD,
  normalizeModelId,
  priceFor,
  type ModelPricing,
} from "./pricing.js";
import { displayModelName } from "./model-names.js";
import type {
  CodexRolloutRecord,
  CodexTokenUsage,
} from "./transcript-format.js";
import type {
  ModelBreakdown,
  SessionUsage,
} from "../../types/session.js";

interface ModelTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
}

/** Sum Codex token_count billing events from one rollout JSONL file. */
export class UsageCalculator {
  private unknownModels = new Set<string>();

  async calculate(
    transcriptPath: string,
    fallbackSessionId: string,
  ): Promise<SessionUsage> {
    this.unknownModels.clear();
    const expanded = expandHome(transcriptPath);
    if (!existsSync(expanded)) {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    const content = await readFile(expanded, "utf-8");
    const totalsByModel = new Map<string, ModelTotals>();
    const seenCumulativeUsage = new Set<string>();
    let currentModel = "unknown";
    let sessionId = fallbackSessionId;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let record: CodexRolloutRecord;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type === "session_meta") {
        sessionId = record.payload?.id || record.payload?.session_id || sessionId;
        continue;
      }

      if (record.type === "turn_context" && record.payload?.model) {
        currentModel = normalizeModelId(record.payload.model);
        continue;
      }

      if (
        record.type !== "event_msg" ||
        record.payload?.type !== "token_count" ||
        !record.payload.info?.last_token_usage
      ) {
        continue;
      }

      // token_count sometimes gets replayed into a rollout. The cumulative
      // tuple identifies a billing event more reliably than last_token_usage,
      // whose values can legitimately repeat on two same-sized requests.
      const cumulative = record.payload.info.total_token_usage;
      if (cumulative) {
        const key = this.usageKey(cumulative);
        if (seenCumulativeUsage.has(key)) continue;
        seenCumulativeUsage.add(key);
      }

      const usage = record.payload.info.last_token_usage;
      const model = normalizeModelId(currentModel);
      const totals = totalsByModel.get(model) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
      };

      const allInput = Math.max(0, usage.input_tokens ?? 0);
      const cached = Math.min(
        allInput,
        Math.max(0, usage.cached_input_tokens ?? 0),
      );
      const uncached = allInput - cached;
      const output = Math.max(0, usage.output_tokens ?? 0);

      totals.inputTokens += uncached;
      totals.cacheReadTokens += cached;
      totals.outputTokens += output;
      totals.cost += this.costFor(model, uncached, cached, output, allInput);
      totalsByModel.set(model, totals);
    }

    const breakdowns: ModelBreakdown[] = [...totalsByModel].map(
      ([model, totals]) => ({
        modelName: model,
        displayName: displayModelName(model),
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: totals.cacheReadTokens,
        cost: totals.cost,
      }),
    );
    breakdowns.sort((a, b) => b.cost - a.cost);

    const totalInput = breakdowns.reduce((sum, x) => sum + x.inputTokens, 0);
    const totalOutput = breakdowns.reduce((sum, x) => sum + x.outputTokens, 0);
    const totalCacheRead = breakdowns.reduce(
      (sum, x) => sum + (x.cacheReadTokens ?? 0),
      0,
    );

    return {
      provider: "codex",
      sessionId,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationTokens: 0,
      cacheReadTokens: totalCacheRead,
      totalTokens: totalInput + totalOutput + totalCacheRead,
      totalCost: breakdowns.reduce((sum, x) => sum + x.cost, 0),
      modelsUsed: breakdowns.map((x) => x.modelName),
      modelBreakdowns: breakdowns,
    };
  }

  getUnknownModels(): string[] {
    return [...this.unknownModels];
  }

  private costFor(
    model: string,
    uncachedInput: number,
    cachedInput: number,
    output: number,
    allInput: number,
  ): number {
    const pricing = priceFor(model);
    if (!pricing) {
      this.unknownModels.add(model);
      return 0;
    }

    const rates = this.ratesFor(pricing, allInput);
    return (
      (uncachedInput * rates.input +
        cachedInput * rates.cachedInput +
        output * rates.output) /
      1_000_000
    );
  }

  private ratesFor(pricing: ModelPricing, allInput: number): ModelPricing {
    if (
      allInput <= LONG_CONTEXT_THRESHOLD ||
      pricing.longInput === undefined ||
      pricing.longCachedInput === undefined ||
      pricing.longOutput === undefined
    ) {
      return pricing;
    }

    return {
      input: pricing.longInput,
      cachedInput: pricing.longCachedInput,
      output: pricing.longOutput,
    };
  }

  private usageKey(usage: CodexTokenUsage): string {
    return [
      usage.input_tokens ?? 0,
      usage.cached_input_tokens ?? 0,
      usage.output_tokens ?? 0,
      usage.reasoning_output_tokens ?? 0,
      usage.total_tokens ?? 0,
    ].join(":");
  }
}
