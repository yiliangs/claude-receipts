/**
 * Canonical usage-data root resolution.
 *
 * Every shard writer and portal reader must resolve the same directory:
 *
 *   1. `dataRoot` in ~/.agent-usage-stat.config.json
 *   2. an existing shared root on a Google Drive mount
 *   3. ~/.agent-usage-stat/data
 *
 * Shared-root detection only accepts a directory that already contains
 * `logbook.d/`. It never creates a new cloud directory implicitly.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homeDir, expandHome, configFilePath } from "./paths.js";

const SHARED_DIR_NAME = "agent-usage-stat";
const SHARD_DIR_NAME = "logbook.d";

export type UsageRootSource = "config" | "detected" | "default";

export interface ResolvedUsageRoot {
  root: string;
  source: UsageRootSource;
}

export function resolveUsageRoot(config: {
  dataRoot?: string;
}): ResolvedUsageRoot {
  const configured = config.dataRoot?.trim();
  if (configured) {
    return { root: expandHome(configured), source: "config" };
  }

  const detected = detectSharedUsageRoot();
  if (detected) {
    return { root: detected, source: "detected" };
  }

  return { root: `${homeDir()}/.agent-usage-stat/data`, source: "default" };
}

export function resolveUsageRootFromDisk(): ResolvedUsageRoot {
  let config: { dataRoot?: string } = {};
  try {
    config = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  } catch {
    // Missing or invalid config falls through to detection and local default.
  }
  return resolveUsageRoot(config);
}

export function detectSharedUsageRoot(): string | null {
  for (const mount of driveMountCandidates()) {
    const root = join(mount, SHARED_DIR_NAME);
    if (existsSync(join(root, SHARD_DIR_NAME))) {
      return root;
    }
  }
  return null;
}

function driveMountCandidates(): string[] {
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

  return candidates;
}
