import type { TranscriptSegment, SpeakerCandidate } from "../types.js";

export function detectSpeakerTransitions(
  segments: TranscriptSegment[],
  speakerWeight: number
): SpeakerCandidate[] {
  const candidates: SpeakerCandidate[] = [];

  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];

    if (prev.speaker_id !== curr.speaker_id) {
      candidates.push({
        timecode_ms: curr.start_ms,
        from_speaker: prev.speaker_id,
        to_speaker: curr.speaker_id,
        weighted_confidence: Math.min(1.0, speakerWeight * 0.5),
      });
    }
  }

  return candidates;
}
