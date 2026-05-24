import type { TranscriptSegment, SilenceCandidate } from "../types.js";

export function detectSilenceGaps(
  segments: TranscriptSegment[],
  silenceBoostThresholdMs: number
): SilenceCandidate[] {
  const candidates: SilenceCandidate[] = [];

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    const gap = curr.start_ms - prev.end_ms;

    if (gap > silenceBoostThresholdMs) {
      candidates.push({
        timecode_ms: curr.start_ms,
        gap_ms: gap,
      });
    }
  }

  return candidates;
}
