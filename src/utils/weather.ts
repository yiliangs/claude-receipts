import geoip from "geoip-lite";

export interface WeatherSnapshot {
  description: string;
  icon: string;
  tempC: number;
  place?: string;
}

/**
 * Fetch the current weather for the user's approximate location.
 *
 * Chain: public IP → geoip-lite lat/lon → Open-Meteo `current_weather`.
 * Returns null on any failure — the footer falls back to omitting the
 * weather block rather than holding up the receipt.
 */
export class WeatherFetcher {
  async getCurrentWeather(): Promise<WeatherSnapshot | null> {
    try {
      const coords = await this.resolveCoords();
      if (!coords) return null;

      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}` +
        `&longitude=${coords.lon}&current_weather=true&temperature_unit=celsius`;

      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;

      const json = (await res.json()) as {
        current_weather?: { temperature: number; weathercode: number };
      };
      const cw = json.current_weather;
      if (!cw) return null;

      const { description, icon } = describeWmo(cw.weathercode);
      return {
        description,
        icon,
        tempC: cw.temperature,
        place: coords.place,
      };
    } catch {
      return null;
    }
  }

  private async resolveCoords(): Promise<
    { lat: number; lon: number; place?: string } | null
  > {
    try {
      const ipRes = await fetch("https://api.ipify.org?format=text", {
        signal: AbortSignal.timeout(3000),
      });
      if (!ipRes.ok) return null;
      const ip = (await ipRes.text()).trim();
      if (!ip) return null;

      const geo = geoip.lookup(ip);
      if (!geo?.ll) return null;
      const [lat, lon] = geo.ll;
      const place =
        geo.city && geo.region
          ? `${geo.city}, ${geo.region}`
          : geo.country || undefined;
      return { lat, lon, place };
    } catch {
      return null;
    }
  }
}

/**
 * Map a WMO weather code (Open-Meteo) to a short verbal label and a
 * monochrome unicode glyph that fits the receipt's black/white aesthetic.
 *
 * Icon set is restricted to codepoints with default *text* presentation
 * (☀ ☁ ☂ ❄ ☈). The obvious choices ⛅ U+26C5 and ⛈ U+26C8 default to
 * emoji presentation — Chromium's font fallback grabs Segoe UI Emoji
 * and renders them in color, breaking the receipt's black-and-white
 * aesthetic. Neither U+FE0E (VS15) nor `font-variant-emoji: text`
 * reliably overrides that fallback when no font in the stack actually
 * ships a text glyph for the emoji codepoint. Solution: don't use the
 * emoji codepoints at all. Partly Cloudy shares its icon with Overcast
 * — the text label "Partly Cloudy" carries the distinction.
 *
 * Code reference: https://open-meteo.com/en/docs (Weather variable doc).
 */
function describeWmo(code: number): { description: string; icon: string } {
  switch (code) {
    case 0:
      return { description: "Clear", icon: "☀" };
    case 1:
      return { description: "Mostly Clear", icon: "☀" };
    case 2:
      return { description: "Partly Cloudy", icon: "☁" };
    case 3:
      return { description: "Overcast", icon: "☁" };
    case 45:
    case 48:
      return { description: "Fog", icon: "☁" };
    case 51:
    case 53:
    case 55:
      return { description: "Drizzle", icon: "☂" };
    case 56:
    case 57:
      return { description: "Freezing Drizzle", icon: "☂" };
    case 61:
    case 63:
    case 65:
      return { description: "Rain", icon: "☂" };
    case 66:
    case 67:
      return { description: "Freezing Rain", icon: "☂" };
    case 71:
    case 73:
    case 75:
      return { description: "Snow", icon: "❄" };
    case 77:
      return { description: "Snow Grains", icon: "❄" };
    case 80:
    case 81:
    case 82:
      return { description: "Rain Showers", icon: "☂" };
    case 85:
    case 86:
      return { description: "Snow Showers", icon: "❄" };
    case 95:
      return { description: "Thunderstorm", icon: "☈" };
    case 96:
    case 99:
      return { description: "Thunderstorm w/ Hail", icon: "☈" };
    default:
      return { description: "Unknown", icon: "·" };
  }
}
