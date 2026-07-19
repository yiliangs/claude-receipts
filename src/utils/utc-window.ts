const DAY_MS = 86_400_000;

export interface UtcCalendarWindow {
  startMs: number;
  endMs: number;
}

/**
 * Inclusive UTC calendar window used by both the portal and spend CLI.
 * The start is midnight UTC of the date containing `anchorMs - days`.
 */
export function utcCalendarWindow(
  anchorMs: number,
  days: number,
): UtcCalendarWindow {
  const cutoffDate = new Date(anchorMs - days * DAY_MS);
  return {
    startMs: Date.UTC(
      cutoffDate.getUTCFullYear(),
      cutoffDate.getUTCMonth(),
      cutoffDate.getUTCDate(),
    ),
    endMs: anchorMs,
  };
}
