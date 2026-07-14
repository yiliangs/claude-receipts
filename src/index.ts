// Main exports for the package
export { ClaudeProvider } from "./providers/claude/provider.js";
export { CodexProvider } from "./providers/codex/provider.js";
export {
  detectProvider,
  findSession,
  providerByName,
} from "./providers/registry.js";
export {
  UsageCalculator,
  UsageCalculator as ClaudeUsageCalculator,
} from "./providers/claude/usage-calculator.js";
export {
  SessionFinder,
  SessionFinder as ClaudeSessionFinder,
} from "./providers/claude/session-finder.js";
export {
  TranscriptParser,
  TranscriptParser as ClaudeTranscriptParser,
} from "./providers/claude/transcript-parser.js";
export { UsageCalculator as CodexUsageCalculator } from "./providers/codex/usage-calculator.js";
export { SessionFinder as CodexSessionFinder } from "./providers/codex/session-finder.js";
export { TranscriptParser as CodexTranscriptParser } from "./providers/codex/transcript-parser.js";
export { ConfigManager } from "./core/config-manager.js";
export { CaptureCommand } from "./commands/capture.js";
export { PortalCommand } from "./commands/portal.js";
export {
  resolveUsageRoot,
  resolveUsageRootFromDisk,
  detectSharedUsageRoot,
} from "./utils/usage-root.js";

// Type exports
export type {
  SessionUsage,
  ModelBreakdown,
  ProviderName,
} from "./types/session.js";
export type { SessionProvider, FoundSession } from "./types/provider.js";
export type { ParsedTranscript } from "./types/transcript.js";
export type { TranscriptMessage } from "./providers/claude/transcript-format.js";
export type { CodexRolloutRecord } from "./providers/codex/transcript-format.js";
export type { AppConfig } from "./types/config.js";
export type {
  HookData,
  SessionEndHookData,
  CodexStopHookData,
} from "./types/session-hook.js";
