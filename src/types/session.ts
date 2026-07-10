// Session usage shape consumed by the receipt renderers and the logbook.
// Produced by a provider (src/types/provider.ts) — provider-neutral on the
// way out: renderers and the logbook writer never branch on the provider.

/** Which tool's sessions a usage record came from. Extends when a new
 *  provider lands (e.g. | "codex"). */
export type ProviderName = "claude";

export interface ModelBreakdown {
  /** Normalized model id — aggregation key, logbook `models` entry. */
  modelName: string;
  /** Human-readable name, set by the provider; falls back to modelName. */
  displayName?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost: number;
}

export interface SessionUsage {
  provider: ProviderName;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens: number;
  totalCost: number;
  lastActivity?: string;
  modelsUsed?: string[];
  modelBreakdowns?: ModelBreakdown[];
  projectPath?: string;
}
