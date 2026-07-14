export interface AppConfig {
  version: string;
  /**
   * Directory containing the per-session `logbook.d/` usage shards.
   * A leading `~` is expanded to the home directory. Set this to a synced
   * folder to combine usage from several machines.
   */
  dataRoot?: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  version: "2.0.0",
};
