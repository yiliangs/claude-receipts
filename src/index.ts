// Main exports for the package
export { ClaudeProvider } from "./providers/claude/provider.js";
export { UsageCalculator } from "./providers/claude/usage-calculator.js";
export { SessionFinder } from "./providers/claude/session-finder.js";
export { TranscriptParser } from "./providers/claude/transcript-parser.js";
export { ReceiptGenerator } from "./core/receipt-generator.js";
export { ConfigManager } from "./core/config-manager.js";
export { LocationDetector } from "./utils/location.js";
export { GenerateCommand } from "./commands/generate.js";
export {
  resolveReceiptsRoot,
  resolveReceiptsRootFromDisk,
  detectSharedReceiptsRoot,
} from "./utils/receipts-root.js";

// Type exports
export type {
  SessionUsage,
  ModelBreakdown,
  ProviderName,
} from "./types/session.js";
export type { SessionProvider, FoundSession } from "./types/provider.js";
export type { ParsedTranscript } from "./types/transcript.js";
export type { TranscriptMessage } from "./providers/claude/transcript-format.js";
export type { ReceiptConfig } from "./types/config.js";
export type { SessionEndHookData } from "./types/session-hook.js";
