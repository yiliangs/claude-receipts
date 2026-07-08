// Configuration file types

export interface ReceiptConfig {
  version: string;
  location?: string;
  timezone?: string;
  /**
   * Directory where receipts (HTML/PNG/PDF) and the `logbook.d/` shards are
   * written. A leading `~` is expanded to the home directory. When unset,
   * defaults to `~/.claude-receipts/projects`. Set it to a synced folder
   * (e.g. a Google Drive path like `H:/My Drive/claude-receipts`) to collect
   * receipts across machines.
   */
  receiptsRoot?: string;
}

export const DEFAULT_CONFIG: ReceiptConfig = {
  version: "1.0.0",
};
