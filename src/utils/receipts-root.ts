/**
 * Receipts-root resolution, centralized and cross-platform.
 *
 * Every consumer of the logbook — the generate worker, setup, the ops scripts
 * in scripts/, and the portal's build-data — must agree on ONE root directory,
 * or shards fork across locations and the single-source-of-truth totals drift
 * (the exact failure class the logbook.d/ migration removed). This module is
 * the only place that knows the resolution chain:
 *
 *   1. `receiptsRoot` in ~/.claude-receipts.config.json (leading ~ expanded)
 *   2. an EXISTING shared root auto-detected on a Google Drive mount
 *      (win32: <D..Z>:/My Drive; darwin: ~/Library/CloudStorage/GoogleDrive-*)
 *   3. the local default ~/.claude-receipts/projects
 *
 * Detection only ever JOINS an established shared root — it requires
 * `<mount>/claude-receipts/logbook.d/` to already exist. It never invents a
 * new Drive folder, so a machine that has never been pointed at the shared
 * logbook stays cleanly on the local default.
 *
 * Built-ins only — scripts/ and portal/ import this from dist/ without
 * pulling the package's dependency graph.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homeDir, expandHome, configFilePath } from "./paths.js";

/** Folder name of the shared root on a synced drive. */
const SHARED_DIR_NAME = "claude-receipts";
/** Shard directory that marks a root as an established logbook location. */
const SHARD_DIR_NAME = "logbook.d";

export type ReceiptsRootSource = "config" | "detected" | "default";

export interface ResolvedReceiptsRoot {
  root: string;
  source: ReceiptsRootSource;
}

/**
 * Resolve the receipts root from an already-loaded config object.
 * The generate worker uses this (it has the config in hand anyway).
 */
export function resolveReceiptsRoot(config: {
  receiptsRoot?: string;
}): ResolvedReceiptsRoot {
  const configured = config.receiptsRoot?.trim();
  if (configured) {
    return { root: expandHome(configured), source: "config" };
  }

  const detected = detectSharedReceiptsRoot();
  if (detected) {
    return { root: detected, source: "detected" };
  }

  return { root: `${homeDir()}/.claude-receipts/projects`, source: "default" };
}

/**
 * Resolve the receipts root reading the config file directly (sync).
 * For consumers outside the command flow: scripts/*.mjs and the portal's
 * build-data, which have no ConfigManager instance.
 */
export function resolveReceiptsRootFromDisk(): ResolvedReceiptsRoot {
  let config: { receiptsRoot?: string } = {};
  try {
    config = JSON.parse(readFileSync(configFilePath(), "utf-8"));
  } catch {
    // no config file or unparseable — same as unset, fall through to detection
  }
  return resolveReceiptsRoot(config);
}

/**
 * Find an existing shared receipts root on a Google Drive mount, or null.
 *
 * A candidate counts only if `<mount>/claude-receipts/logbook.d/` exists —
 * i.e. some machine already established it as the shared logbook. Checked
 * mounts:
 *   win32:  <D..Z>:/My Drive (Drive for Desktop, streaming — the letter is
 *           user-chosen, commonly G: or H:), plus ~/Google Drive and
 *           ~/My Drive (mirror mode)
 *   darwin: ~/Library/CloudStorage/GoogleDrive-<account>/My Drive (current
 *           client), plus ~/Google Drive (legacy client)
 *   linux:  none (no official Drive client) — always null
 */
export function detectSharedReceiptsRoot(): string | null {
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
      // no CloudStorage dir — older macOS or Drive not installed
    }
    candidates.push(join(home, "Google Drive"));
  }

  return candidates;
}
