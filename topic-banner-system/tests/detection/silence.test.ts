import { describe, it, expect } from "vitest";
import { detectSilenceGaps } from "../../src/detection/silence.js";
import type { TranscriptSegment } from "../../src/types.js";

const seg = (start: number, end: number, text = "text", speaker = "A"): TranscriptSegment => ({
  start_ms: start,
  end_ms: end,
  text,
  speaker_id: speaker,
});

describe("detectSilenceGaps", () => {
  it("flags gaps above threshold", () => {
    const segments = [seg(0, 1000), seg(2500, 3500)];
    const results = detectSilenceGaps(segments, 1400);
    expect(results).toHaveLength(1);
    expect(results[0].timecode_ms).toBe(2500);
    expect(results[0].gap_ms).toBe(1500);
  });

  it("does not flag gaps below threshold", () => {
    const segments = [seg(0, 1000), seg(2000, 3000)];
    const results = detectSilenceGaps(segments, 1400);
    expect(results).toHaveLength(0);
  });

  it("does not flag gap exactly at threshold", () => {
    const segments = [seg(0, 1000), seg(2400, 3400)];
    const results = detectSilenceGaps(segments, 1400);
    expect(results).toHaveLength(0);
  });

  it("returns empty array for single segment", () => {
    const results = detectSilenceGaps([seg(0, 1000)], 1400);
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    const results = detectSilenceGaps([], 1400);
    expect(results).toHaveLength(0);
  });

  it("flags multiple gaps, skipping one below threshold", () => {
    const segments = [
      seg(0, 1000),
      seg(3000, 4000),   // gap 2000ms > 1400 → flagged
      seg(5200, 6200),   // gap 1200ms < 1400 → not flagged
      seg(9000, 10000),  // gap 2800ms > 1400 → flagged
    ];
    const results = detectSilenceGaps(segments, 1400);
    expect(results).toHaveLength(2);
    expect(results[0].timecode_ms).toBe(3000);
    expect(results[0].gap_ms).toBe(2000);
    expect(results[1].timecode_ms).toBe(9000);
    expect(results[1].gap_ms).toBe(2800);
  });

  it("uses start_ms of next segment as timecode", () => {
    const segments = [seg(0, 500), seg(2000, 3000)];
    const results = detectSilenceGaps(segments, 1400);
    expect(results[0].timecode_ms).toBe(2000);
  });
});
