// Session usage shape consumed by the receipt renderers. Computed from
// the transcript JSONL by UsageCalculator (no external indexer involved).

export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost: number;
}

export interface SessionUsage {
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
