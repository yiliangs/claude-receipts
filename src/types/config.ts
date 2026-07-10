// Configuration file types

export interface ReceiptConfig {
  version: string;
  location?: string;
  timezone?: string;
  /**
   * Directory where receipts (HTML/PNG/PDF) and the `logbook.d/` shards are
   * written. A leading `~` is expanded to the home directory. Set it to a
   * synced folder to collect receipts across machines — e.g.
   * `H:/My Drive/claude-receipts` (Windows) or
   * `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/claude-receipts`
   * (macOS). When unset, utils/receipts-root.ts auto-detects an established
   * shared root on a Google Drive mount, else falls back to
   * `~/.claude-receipts/projects`.
   */
  receiptsRoot?: string;
}

export const DEFAULT_CONFIG: ReceiptConfig = {
  version: "1.0.0",
};
