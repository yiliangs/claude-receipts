/**
 * Canonical usage-data root resolution.
 *
 * Configured roots remain authoritative even when temporarily unavailable so a
 * missing Drive mount cannot silently fork writes into a local directory.
 * Auto-detected roots are accepted only when they already contain logbook.d/.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, normalize, resolve } from "path";
import {
  configFilePath,
  defaultUsageRoot,
  expandHome,
  homeDir,
  legacyConfigFilePath,
  legacyUsageRoot,
  transitionalUsageRoot,
} from "./paths.js";
import {
  validateCurrentConfig,
  validateLegacyConfig,
} from "./config-shape.js";

export const SHARD_DIR_NAME = "logbook.d";
export const SHARED_DIR_NAME = "agent-usage-stat";
export const LEGACY_SHARED_DIR_NAME = "claude-receipts";

export type UsageRootSource =
  | "config"
  | "legacy-config"
  | "new-shared"
  | "legacy-shared"
  | "new-local"
  | "transitional-local"
  | "legacy-local"
  | "default";

export interface ResolvedUsageRoot {
  root: string;
  source: UsageRootSource;
}

export interface UsageRootCandidate extends ResolvedUsageRoot {
  requiresShardDirectory: boolean;
}

export interface UsageRootConfig {
  dataRoot?: string;
  legacyReceiptsRoot?: string;
}

export interface UsageRootCandidateOptions extends UsageRootConfig {
  mounts?: string[];
  newLocalRoot?: string;
  transitionalLocalRoot?: string;
  legacyLocalRoot?: string;
}

export function shardDirectory(root: string): string {
  return join(root, SHARD_DIR_NAME);
}

export function usageRootCandidates(
  options: UsageRootCandidateOptions = {},
): UsageRootCandidate[] {
  const candidates: UsageRootCandidate[] = [];
  const configured = options.dataRoot?.trim();
  const legacyConfigured = options.legacyReceiptsRoot?.trim();

  if (configured) {
    candidates.push({
      root: expandHome(configured),
      source: "config",
      requiresShardDirectory: false,
    });
  }
  if (legacyConfigured) {
    candidates.push({
      root: expandHome(legacyConfigured),
      source: "legacy-config",
      requiresShardDirectory: false,
    });
  }

  for (const mount of options.mounts ?? driveMountCandidates()) {
    candidates.push({
      root: join(mount, SHARED_DIR_NAME),
      source: "new-shared",
      requiresShardDirectory: true,
    });
  }
  for (const mount of options.mounts ?? driveMountCandidates()) {
    candidates.push({
      root: join(mount, LEGACY_SHARED_DIR_NAME),
      source: "legacy-shared",
      requiresShardDirectory: true,
    });
  }

  candidates.push(
    {
      root: options.newLocalRoot ?? defaultUsageRoot(),
      source: "new-local",
      requiresShardDirectory: true,
    },
    {
      root: options.transitionalLocalRoot ?? transitionalUsageRoot(),
      source: "transitional-local",
      requiresShardDirectory: true,
    },
    {
      root: options.legacyLocalRoot ?? legacyUsageRoot(),
      source: "legacy-local",
      requiresShardDirectory: true,
    },
    {
      root: options.newLocalRoot ?? defaultUsageRoot(),
      source: "default",
      requiresShardDirectory: false,
    },
  );

  return deduplicateCandidates(candidates);
}

export function resolveUsageRoot(
  config: UsageRootConfig,
  options: Omit<UsageRootCandidateOptions, keyof UsageRootConfig> = {},
): ResolvedUsageRoot {
  const candidates = usageRootCandidates({ ...options, ...config });
  for (const candidate of candidates) {
    if (
      !candidate.requiresShardDirectory ||
      existsSync(shardDirectory(candidate.root))
    ) {
      return { root: candidate.root, source: candidate.source };
    }
  }

  return { root: options.newLocalRoot ?? defaultUsageRoot(), source: "default" };
}

export function resolveUsageRootFromDisk(): ResolvedUsageRoot {
  const currentPath = configFilePath();
  if (existsSync(currentPath)) {
    const current = validateCurrentConfig(readJsonFile(currentPath), currentPath);
    return resolveUsageRoot({ dataRoot: current.dataRoot });
  }

  const legacyPath = legacyConfigFilePath();
  const legacy = existsSync(legacyPath)
    ? validateLegacyConfig(readJsonFile(legacyPath), legacyPath)
    : {};
  return resolveUsageRoot({ legacyReceiptsRoot: legacy.receiptsRoot });
}

/** Enumerate current, legacy, shared, and local roots for diagnostics/migration. */
export function usageRootCandidatesFromDisk(): UsageRootCandidate[] {
  const currentPath = configFilePath();
  const legacyPath = legacyConfigFilePath();
  const current = existsSync(currentPath)
    ? validateCurrentConfig(readJsonFile(currentPath), currentPath)
    : {};
  const legacy = existsSync(legacyPath)
    ? validateLegacyConfig(readJsonFile(legacyPath), legacyPath)
    : {};
  return usageRootCandidates({
    dataRoot: current.dataRoot,
    legacyReceiptsRoot: legacy.receiptsRoot,
  });
}

/** Detect an existing shared v2 or legacy root without considering config. */
export function detectSharedUsageRoot(): string | null {
  const candidates = usageRootCandidates().filter(
    (candidate) =>
      candidate.source === "new-shared" ||
      candidate.source === "legacy-shared",
  );
  const match = candidates.find((candidate) =>
    existsSync(shardDirectory(candidate.root)),
  );
  return match?.root ?? null;
}

export function driveMountCandidates(): string[] {
  const home = homeDir();
  const candidates: string[] = [];

  if (process.platform === "win32") {
    for (let c = "D".charCodeAt(0); c <= "Z".charCodeAt(0); c++) {
      candidates.push(`${String.fromCharCode(c)}:/My Drive`);
    }
    candidates.push(join(home, "Google Drive"), join(home, "My Drive"));
  } else if (process.platform === "darwin") {
    const cloudStorage = join(home, "Library", "CloudStorage");
    try {
      for (const entry of readdirSync(cloudStorage)) {
        if (entry.startsWith("GoogleDrive-")) {
          candidates.push(join(cloudStorage, entry, "My Drive"));
        }
      }
    } catch {
      // Google Drive is not installed or uses an older mount layout.
    }
    candidates.push(join(home, "Google Drive"));
  }

  return deduplicatePaths(candidates);
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Failed to parse usage config ${path}: ${message}`);
  }
}

function deduplicateCandidates(
  candidates: UsageRootCandidate[],
): UsageRootCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = pathKey(candidate.root);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicatePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = pathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pathKey(path: string): string {
  const value = normalize(resolve(path));
  return process.platform === "win32" ? value.toLowerCase() : value;
}
