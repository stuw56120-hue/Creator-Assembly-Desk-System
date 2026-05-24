export function resolveStartOffset(
  detectedTimecodeMs: number,
  defaultOffsetMs: number,
  previousBannerExitEndMs: number | null
): number {
  if (previousBannerExitEndMs === null) {
    return defaultOffsetMs;
  }

  const proposedStart = detectedTimecodeMs + defaultOffsetMs;

  if (proposedStart < previousBannerExitEndMs) {
    return 0;
  }

  return defaultOffsetMs;
}
