/**
 * Per-million-token pricing for Anthropic Claude models (USD).
 *
 * Verified against ccusage output 2026-05-19: a real Opus 4.7 session
 * with 9,495 in / 6,185 out / 132,921 cache-create / 1,854,610 cache-read
 * cost $1.960 — exactly matches input×$5 + output×$25 + cacheWrite×$6.25
 * + cacheRead×$0.50 per million.
 *
 * Cache write here is the 5-minute TTL rate (1.25× input). The transcript
 * JSONL reports cache_creation_input_tokens as a single field with no TTL
 * distinction, so 1-hour cache writes (2× input) get priced as 5-minute.
 * The discrepancy is bounded — a session that exclusively uses 1h caching
 * would underbill by up to ~12% of the cache-write cost (typically <2% of
 * total session cost).
 *
 * When Anthropic ships a new model, add an entry. Unknown models bill at $0
 * and emit a `unknownModel` warning to hook.log — better to underbill
 * visibly than to misbill silently against a stale rate.
 */
export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Current generation (June 2026)
  // Fable 5 is the new top tier above Opus — $10/$50 per MTok.
  "claude-fable-5":     { input: 10, output: 50, cacheWrite: 12.50, cacheRead: 1.00 },
  "claude-opus-4-8":    { input: 5,  output: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  "claude-opus-4-7":    { input: 5,  output: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  "claude-sonnet-5":    { input: 3,  output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-sonnet-4-6":  { input: 3,  output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-haiku-4-5":   { input: 1,  output: 5,  cacheWrite: 1.25, cacheRead: 0.10 },

  // Prior generation — still appears in older transcripts.
  // Opus dropped to $5/$25 at the 4.5 launch (Nov 2025); only 4.1 and
  // earlier carry the old $15/$75 rate.
  "claude-opus-4-6":    { input: 5,  output: 25, cacheWrite: 6.25,  cacheRead: 0.50 },
  "claude-opus-4-5":    { input: 5,  output: 25, cacheWrite: 6.25,  cacheRead: 0.50 },
  "claude-sonnet-4-5":  { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.30 },
  "claude-opus-4-1":    { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4-0":    { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4":      { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-sonnet-4-0":  { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.30 },
  "claude-sonnet-4":    { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.30 },

  // Legacy
  "claude-3-7-sonnet":  { input: 3,    output: 15,   cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-3-5-sonnet":  { input: 3,    output: 15,   cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-3-5-haiku":   { input: 0.80, output: 4,    cacheWrite: 1.00, cacheRead: 0.08 },
  "claude-3-opus":      { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-3-haiku":     { input: 0.25, output: 1.25, cacheWrite: 0.30,  cacheRead: 0.03 },
};

/**
 * Anthropic model IDs come in three flavors:
 *   - Alias:           "claude-opus-4-8"
 *   - Snapshot:        "claude-haiku-4-5-20251001"
 *   - Context variant: "claude-opus-4-8[1m]" (1M-context routing — same
 *     standard pricing, no long-context premium)
 * Strip the bracket suffix first, then an 8-digit date suffix, so every
 * shape resolves to the same table entry. Without the bracket strip, [1m]
 * sessions fail the lookup and silently bill at $0.
 */
export function normalizeModelId(model: string): string {
  return model.replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
}

/**
 * Look up pricing for a model. Returns null for unknown models — callers
 * should record this in the hook log so stale tables surface visibly.
 */
export function priceFor(model: string): ModelPricing | null {
  return PRICING[normalizeModelId(model)] ?? null;
}
