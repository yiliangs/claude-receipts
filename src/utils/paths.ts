/**
 * Home-directory and application-path resolution, centralized.
 *
 * Built-ins only, with no third-party imports, so this stays cheap to load and
 * safe for the hook and statusline command paths.
 */

/** The user's home directory, or "" if neither env var is set. */
export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

/** Absolute path of the v2 configuration file. */
export function configFilePath(): string {
  return `${homeDir()}/.agent-usage-stat.config.json`;
}

/** Absolute path of the pre-v2 configuration file. */
export function legacyConfigFilePath(): string {
  return `${homeDir()}/.claude-receipts.config.json`;
}

/** Default local v2 usage-data root. */
export function defaultUsageRoot(): string {
  return `${homeDir()}/.agent-usage-stat/data`;
}

/** Transitional v2 root used briefly by maintenance scripts. */
export function transitionalUsageRoot(): string {
  return `${homeDir()}/.agent-usage-stat/projects`;
}

/** Pre-v2 local usage-data root. */
export function legacyUsageRoot(): string {
  return `${homeDir()}/.claude-receipts/projects`;
}

/** Expand a leading "~" to the home directory. */
export function expandHome(path: string): string {
  return path.replace(/^~/, homeDir());
}
