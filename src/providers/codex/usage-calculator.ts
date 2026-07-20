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
import { fingerprintTranscriptContent } from "./transcript-fingerprint.js";
import type {
  CodexRolloutRecord,
  CodexTokenUsage,
} from "./transcript-format.js";
import type {
  ModelBreakdown,
  SessionUsage,
  TurnUsage,
} from "../../types/session.js";

interface ModelTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

interface TurnAccumulator {
  id: string;
  startTime: string;
  endTime: string;
  totalsByModel: Map<string, ModelTotals>;
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
    const sourceFingerprint = fingerprintTranscriptContent(content);
    const totalsByModel = new Map<string, ModelTotals>();
    const turns = new Map<string, TurnAccumulator>();
    const seenCumulativeUsage = new Set<string>();
    // A rollout can emit token_count before its first turn_context. Those tokens
    // are real spend by the model the rollout goes on to declare, so seed the
    // model from that declaration instead of a sentinel: a sentinel has no
    // pricing entry and silently bills the leading turns at $0.
    let currentModel = firstDeclaredModel(content) ?? "unknown";
    let currentTurn: TurnAccumulator | undefined;
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

      if (record.type === "turn_context") {
        if (record.payload?.model) {
          currentModel = normalizeModelId(record.payload.model);
        }
        const id = record.payload?.turn_id || `turn-${turns.size + 1}`;
        const timestamp = record.timestamp || "";
        currentTurn = turns.get(id) ?? {
          id,
          startTime: timestamp,
          endTime: timestamp,
          totalsByModel: new Map<string, ModelTotals>(),
        };
        turns.set(id, currentTurn);
        continue;
      }

      if (currentTurn && record.timestamp) {
        currentTurn.endTime = record.timestamp;
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
      if (!currentTurn) {
        const timestamp = record.timestamp || "";
        currentTurn = {
          id: "turn-1",
          startTime: timestamp,
          endTime: timestamp,
          totalsByModel: new Map<string, ModelTotals>(),
        };
        turns.set(currentTurn.id, currentTurn);
      }

      const allInput = Math.max(0, usage.input_tokens ?? 0);
      const cached = Math.min(
        allInput,
        Math.max(0, usage.cached_input_tokens ?? 0),
      );
      // Older Codex rollouts omit this field. Keep those tokens as ordinary
      // input instead of inventing a cache-write count that cannot be audited.
      const cacheWrite = Math.min(
        allInput - cached,
        Math.max(0, usage.cache_write_tokens ?? 0),
      );
      const uncached = allInput - cached - cacheWrite;
      const output = Math.max(0, usage.output_tokens ?? 0);

      const cost = this.costFor(
        model,
        uncached,
        cached,
        cacheWrite,
        output,
        allInput,
      );
      this.addUsage(
        totalsByModel,
        model,
        uncached,
        cached,
        cacheWrite,
        output,
        cost,
      );
      this.addUsage(
        currentTurn.totalsByModel,
        model,
        uncached,
        cached,
        cacheWrite,
        output,
        cost,
      );
    }

    const breakdowns = this.toBreakdowns(totalsByModel);

    const totalInput = breakdowns.reduce((sum, x) => sum + x.inputTokens, 0);
    const totalOutput = breakdowns.reduce((sum, x) => sum + x.outputTokens, 0);
    const totalCacheCreate = breakdowns.reduce(
      (sum, x) => sum + (x.cacheCreationTokens ?? 0),
      0,
    );
    const totalCacheRead = breakdowns.reduce(
      (sum, x) => sum + (x.cacheReadTokens ?? 0),
      0,
    );
    const turnUsage = [...turns.values()]
      .map((turn) => this.toTurnUsage(turn))
      .filter((turn) => turn.totalTokens > 0)
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    return {
      provider: "codex",
      sessionId,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationTokens: totalCacheCreate,
      cacheReadTokens: totalCacheRead,
      totalTokens: totalInput + totalOutput + totalCacheCreate + totalCacheRead,
      totalCost: breakdowns.reduce((sum, x) => sum + x.cost, 0),
      modelsUsed: breakdowns.map((x) => x.modelName),
      modelBreakdowns: breakdowns,
      turns: turnUsage,
      sourceFingerprint,
    };
  }

  getUnknownModels(): string[] {
    return [...this.unknownModels];
  }

  private addUsage(
    totalsByModel: Map<string, ModelTotals>,
    model: string,
    input: number,
    cached: number,
    cacheWrite: number,
    output: number,
    cost: number,
  ): void {
    const totals = totalsByModel.get(model) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: 0,
    };
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheCreationTokens += cacheWrite;
    totals.cacheReadTokens += cached;
    totals.cost += cost;
    totalsByModel.set(model, totals);
  }

  private toBreakdowns(
    totalsByModel: Map<string, ModelTotals>,
  ): ModelBreakdown[] {
    const breakdowns = [...totalsByModel].map(([model, totals]) => ({
      modelName: model,
      displayName: displayModelName(model),
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cost: totals.cost,
    }));
    breakdowns.sort((a, b) => b.cost - a.cost);
    return breakdowns;
  }

  private toTurnUsage(turn: TurnAccumulator): TurnUsage {
    const breakdowns = this.toBreakdowns(turn.totalsByModel);
    const sum = (pick: (x: ModelBreakdown) => number): number =>
      breakdowns.reduce((total, item) => total + pick(item), 0);
    const inputTokens = sum((x) => x.inputTokens);
    const outputTokens = sum((x) => x.outputTokens);
    const cacheCreationTokens = sum((x) => x.cacheCreationTokens ?? 0);
    const cacheReadTokens = sum((x) => x.cacheReadTokens ?? 0);
    return {
      id: turn.id,
      startTime: turn.startTime,
      endTime: turn.endTime || turn.startTime,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens:
        inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
      totalCost: sum((x) => x.cost),
      modelsUsed: breakdowns.map((x) => x.modelName),
      modelBreakdowns: breakdowns,
    };
  }

  private costFor(
    model: string,
    uncachedInput: number,
    cachedInput: number,
    cacheWriteInput: number,
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
        cacheWriteInput * (rates.cacheWrite ?? rates.input) +
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
      cacheWrite: pricing.longCacheWrite ?? pricing.longInput,
      output: pricing.longOutput,
    };
  }

  private usageKey(usage: CodexTokenUsage): string {
    return [
      usage.input_tokens ?? 0,
      usage.cached_input_tokens ?? 0,
      usage.cache_write_tokens ?? 0,
      usage.output_tokens ?? 0,
      usage.reasoning_output_tokens ?? 0,
      usage.total_tokens ?? 0,
    ].join(":");
  }
}

/**
 * The model of the first turn_context that declares one. Used to attribute
 * token_count events that precede any turn_context — see calculate().
 */
function firstDeclaredModel(content: string): string | null {
  for (const line of content.split("\n")) {
    if (!line.includes("turn_context")) continue;
    try {
      const record: CodexRolloutRecord = JSON.parse(line);
      if (record.type === "turn_context" && record.payload?.model) {
        return normalizeModelId(record.payload.model);
      }
    } catch {
      continue;
    }
  }
  return null;
}
