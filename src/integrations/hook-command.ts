import { resolve } from "path";
import { fileURLToPath } from "url";
import { homeDir } from "../utils/paths.js";

export interface HookExecutablePaths {
  unixWrapper: string;
  windowsBin: string;
}

export function hookExecutablePaths(): HookExecutablePaths {
  const packageRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  const wrapperPath = resolve(packageRoot, "bin", "run-hook.sh");
  const binPath = resolve(packageRoot, "bin", "agent-usage-stat.js");
  const home = homeDir().replace(/\\/g, "/");
  const normalized = wrapperPath.replace(/\\/g, "/");
  const unixWrapper =
    home && normalized.toLowerCase().startsWith(home.toLowerCase())
      ? "$HOME" + normalized.slice(home.length)
      : normalized;
  return { unixWrapper, windowsBin: binPath };
}

/** Recognize both the current package hook and hooks from its old name. */
export function isAgentUsageStatCommand(command: string): boolean {
  const normalized = command.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("agent-usage-stat") ||
    (normalized.includes("/bin/run-hook.sh") &&
      (normalized.includes(" capture") || normalized.includes(" generate")))
  );
}
