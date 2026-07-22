/**
 * Which company's model produced the tokens — the axis the portal charts.
 *
 * This is deliberately NOT the same thing as `provider` (src/types/session.ts),
 * which records the host tool that produced the transcript. The two used to be
 * conflated, and the conflation cost real money twice: GPT models routed through
 * Claude Code billed at $0 because pricing was chosen by host, and every one of
 * those sessions charted as Anthropic spend.
 *
 * Host and vendor are independent. Claude Code can route to GPT, and a session's
 * subagents inherit whatever the parent runs, so a single session can in
 * principle mix vendors. Derive vendor per MODEL, never per session.
 */
export type ModelVendor = "anthropic" | "openai" | "unknown";

export function vendorForModel(model: string): ModelVendor {
  const id = model.trim().toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt") || id.startsWith("codex")) return "openai";
  return "unknown";
}

/** Display label for a vendor, used by the portal's series legend. */
export function vendorLabel(vendor: ModelVendor): string {
  if (vendor === "anthropic") return "Anthropic";
  if (vendor === "openai") return "OpenAI";
  return "Unknown";
}
