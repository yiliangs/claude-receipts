import { normalizeModelId } from "./pricing.js";

/**
 * Human-readable display names for Claude model IDs, shared by all three
 * renderers (text receipt, HTML, thermal printer). Keyed by the normalized
 * alias — normalizeModelId strips date suffixes ("-20251001") and context
 * variant suffixes ("[1m]") so every shape of the same model resolves here.
 *
 * Keep this list in sync with the PRICING table in pricing.ts: any model that
 * can be billed should also render with a proper name.
 */
const DISPLAY_NAMES: Record<string, string> = {
  // Current generation (June 2026)
  "claude-fable-5": "Claude Fable 5",
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  // Prior generation
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-5": "Claude Opus 4.5",
  "claude-sonnet-4-5": "Claude Sonnet 4.5",
  "claude-opus-4-1": "Claude Opus 4.1",
  "claude-opus-4-0": "Claude Opus 4",
  "claude-opus-4": "Claude Opus 4",
  "claude-sonnet-4-0": "Claude Sonnet 4",
  "claude-sonnet-4": "Claude Sonnet 4",
  // Legacy
  "claude-3-7-sonnet": "Claude 3.7 Sonnet",
  "claude-3-5-sonnet": "Claude 3.5 Sonnet",
  "claude-3-5-haiku": "Claude 3.5 Haiku",
  "claude-3-opus": "Claude 3 Opus",
  "claude-3-haiku": "Claude 3 Haiku",
};

export function displayModelName(model: string): string {
  return DISPLAY_NAMES[normalizeModelId(model)] || model;
}
