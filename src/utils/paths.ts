/**
 * Home-directory resolution, centralized.
 *
 * Windows has no $HOME — it uses $USERPROFILE. That fallback was hand-copied
 * across config-manager, session-finder, transcript-parser, usage-calculator,
 * and generate; a single call site that forgot the $USERPROFILE half would
 * silently break every path on Windows. Keep it in one place so the invariant
 * can't drift.
 *
 * Built-ins only — no third-party imports — so this stays cheap to load and
 * safe for any module to depend on.
 */

/** The user's home directory, or "" if neither env var is set. */
export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

/**
 * Absolute path of the user config file. Shared by ConfigManager (async R/W)
 * and usage-root.ts (sync read from scripts/portal), so the location can't
 * drift between the two.
 */
export function configFilePath(): string {
  return `${homeDir()}/.agent-usage-stat.config.json`;
}

/**
 * Expand a leading "~" to the home directory. Leaves any other path untouched.
 * Matches the prior inline behavior (`replace(/^~/, home)`).
 */
export function expandHome(path: string): string {
  return path.replace(/^~/, homeDir());
}
