/** Standard OpenAI API list prices in USD per million tokens. */
export interface ModelPricing {
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
  longInput?: number;
  longCachedInput?: number;
  longCacheWrite?: number;
  longOutput?: number;
}

/** GPT-5.4+ long-context pricing begins above 272K input tokens per request. */
export const LONG_CONTEXT_THRESHOLD = 272_000;

// Sources: https://developers.openai.com/api/docs/pricing and
// https://developers.openai.com/api/docs/guides/prompt-caching,
// checked 2026-07-14.
// Codex sessions paid through a ChatGPT plan do not incur these dollar charges;
// the table reports API-equivalent list cost, matching this project's existing
// Claude-compatible usage semantics.
const PRICING: Record<string, ModelPricing> = {
  "gpt-5.6-sol": {
    input: 5,
    cachedInput: 0.5,
    cacheWrite: 6.25,
    output: 30,
    longInput: 10,
    longCachedInput: 1,
    longCacheWrite: 12.5,
    longOutput: 45,
  },
  "gpt-5.6-terra": {
    input: 2.5,
    cachedInput: 0.25,
    cacheWrite: 3.125,
    output: 15,
    longInput: 5,
    longCachedInput: 0.5,
    longCacheWrite: 6.25,
    longOutput: 22.5,
  },
  "gpt-5.6-luna": {
    input: 1,
    cachedInput: 0.1,
    cacheWrite: 1.25,
    output: 6,
    longInput: 2,
    longCachedInput: 0.2,
    longCacheWrite: 2.5,
    longOutput: 9,
  },
  "gpt-5.5": {
    input: 5,
    cachedInput: 0.5,
    output: 30,
    longInput: 10,
    longCachedInput: 1,
    longOutput: 45,
  },
  "gpt-5.5-pro": {
    input: 30,
    cachedInput: 30,
    output: 180,
    longInput: 60,
    longCachedInput: 60,
    longOutput: 270,
  },
  "gpt-5.4": {
    input: 2.5,
    cachedInput: 0.25,
    output: 15,
    longInput: 5,
    longCachedInput: 0.5,
    longOutput: 22.5,
  },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-pro": {
    input: 30,
    cachedInput: 30,
    output: 180,
    longInput: 60,
    longCachedInput: 60,
    longOutput: 270,
  },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
};

export function normalizeModelId(model: string): string {
  const normalized = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return normalized === "gpt-5.6" ? "gpt-5.6-sol" : normalized;
}

export function priceFor(model: string): ModelPricing | null {
  return PRICING[normalizeModelId(model)] ?? null;
}
