import {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
} from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import {
  configFilePath,
  legacyConfigFilePath,
} from "../utils/paths.js";
import type { AppConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import {
  validateCurrentConfig,
  validateLegacyConfig,
} from "../utils/config-shape.js";

export class ConfigManager {
  private configPath: string;
  private legacyConfigPath: string;

  constructor(
    configPath = configFilePath(),
    legacyPath = legacyConfigFilePath(),
  ) {
    this.configPath = configPath;
    this.legacyConfigPath = legacyPath;
  }

  /** Load v2 configuration, falling back to legacy only when v2 is absent. */
  async loadConfig(): Promise<AppConfig> {
    const currentValue = await this.readJson(this.configPath);
    if (currentValue !== undefined) {
      const current = validateCurrentConfig(currentValue, this.configPath);
      return {
        version: DEFAULT_CONFIG.version,
        ...(current.dataRoot ? { dataRoot: current.dataRoot } : {}),
      };
    }

    const legacyValue = await this.readJson(this.legacyConfigPath);
    if (legacyValue !== undefined) {
      const legacy = validateLegacyConfig(legacyValue, this.legacyConfigPath);
      if (legacy.receiptsRoot) {
        return {
          version: DEFAULT_CONFIG.version,
          dataRoot: legacy.receiptsRoot,
        };
      }
    }

    return DEFAULT_CONFIG;
  }

  /** Save configuration atomically in the v2 location and shape. */
  async saveConfig(config: AppConfig): Promise<void> {
    const normalized: AppConfig = {
      version: DEFAULT_CONFIG.version,
      ...(config.dataRoot?.trim() ? { dataRoot: config.dataRoot.trim() } : {}),
    };

    await mkdir(dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(
        temporaryPath,
        JSON.stringify(normalized, null, 2),
        "utf-8",
      );
      await rename(temporaryPath, this.configPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async updateConfig(key: keyof AppConfig, value: unknown): Promise<void> {
    const config = await this.loadConfig();
    (config as unknown as Record<string, unknown>)[key] = value;
    await this.saveConfig(config);
  }

  async resetConfig(): Promise<void> {
    await this.saveConfig(DEFAULT_CONFIG);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  private async readJson(path: string): Promise<unknown | undefined> {
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(await readFile(path, "utf-8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON";
      throw new Error(`Failed to parse usage config ${path}: ${message}`);
    }
  }
}
