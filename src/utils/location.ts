import geoip from "geoip-lite";
import { readFile } from "fs/promises";
import type { ReceiptConfig } from "../types/config.js";

export class LocationDetector {
  /**
   * Resolve the geographic location string for the receipt. Priority:
   *   1. `override` (e.g. CLI `--location`)
   *   2. `config.location`
   *   3. IP geolocation (offline geoip-lite)
   *   4. Fallback "The Cloud"
   *
   * Path-like inputs at (1) and (2) are silently ignored so a stale config
   * value (e.g. `H:\My Drive\claude-receipts` from before validation existed)
   * can't poison the logbook with file paths in the city column.
   */
  async getLocation(config: ReceiptConfig, override?: string): Promise<string> {
    if (override && !LocationDetector.looksLikePath(override)) {
      return override;
    }

    if (config.location && !LocationDetector.looksLikePath(config.location)) {
      return config.location;
    }

    try {
      const location = await this.detectLocationFromIP();
      if (location) {
        return location;
      }
    } catch (error) {
      // Silent fail, use fallback
    }

    return "The Cloud";
  }

  /**
   * True if `s` looks like a filesystem path (backslash, Windows drive
   * prefix, or tilde-home). Geographic strings like "Chicago, IL" never
   * contain these.
   */
  static looksLikePath(s: string): boolean {
    return /\\/.test(s) || /^[a-zA-Z]:[\\/]/.test(s) || /^~\//.test(s);
  }

  /**
   * Detect location from public IP using geoip-lite
   */
  private async detectLocationFromIP(): Promise<string | null> {
    try {
      // Get public IP from a simple service
      const ip = await this.getPublicIP();
      if (!ip) return null;

      const geo = geoip.lookup(ip);
      if (geo && geo.city && geo.region) {
        return `${geo.city}, ${geo.region}`;
      }

      if (geo && geo.country) {
        return geo.country;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get public IP address
   */
  private async getPublicIP(): Promise<string | null> {
    try {
      // Use a simple IP detection service
      const response = await fetch("https://api.ipify.org?format=text", {
        signal: AbortSignal.timeout(3000), // 3 second timeout
      });

      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }
}
