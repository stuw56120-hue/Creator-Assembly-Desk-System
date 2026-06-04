/*
 * Timecode parsing for the C.A.D.S. edit list.
 *
 * The customGPT emits source timecodes as "[HH:]MM:SS.s" (e.g. "24:18.0",
 * "1:02:03.5"). These helpers convert to/from source seconds.
 */

/** Matches "MM:SS.s" or "HH:MM:SS.s" with an optional fractional second. */
export const TIMECODE_PATTERN = /^(?:(\d+):)?([0-5]?\d):([0-5]?\d)(\.\d+)?$/;

export function isValidTimecode(value: string): boolean {
  return TIMECODE_PATTERN.test(value.trim());
}

/**
 * Parse a "[HH:]MM:SS.s" timecode into source seconds.
 * @throws if the string is not a valid timecode.
 */
export function parseTimecode(value: string): number {
  const match = TIMECODE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid timecode: "${value}" (expected [HH:]MM:SS.s)`);
  }
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]) + (match[4] ? Number(match[4]) : 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Format source seconds as "MM:SS.s" (or "HH:MM:SS.s" past an hour). */
export function formatTimecode(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const secStr = seconds.toFixed(1).padStart(4, "0"); // "08.0", "18.0"
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secStr}`;
  }
  return `${minutes}:${secStr}`;
}
