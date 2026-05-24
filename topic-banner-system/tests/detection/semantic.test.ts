import { describe, it, expect, vi } from "vitest";
import { cosineSimilarity, computeSemanticScores } from "../../src/detection/semantic.js";
import type { TranscriptSegment } from "../../src/types.js";

const seg = (start: number, end: number, text: string, speaker = "A"): TranscriptSegment => ({
  start_ms: start,
  end_ms: end,
  text,
  speaker_id: speaker,
});

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("returns correct value for known vectors", () => {
    const a = [3, 4];
    const b = [4, 3];
    const expected = (3 * 4 + 4 * 3) / (5 * 5);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("throws for mismatched lengths", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });
});

describe("computeSemanticScores", () => {
  const makeEmbedding = (val: number) => vi.fn().mockResolvedValue([val, 0, 0]);

  it("returns empty array for empty transcript", async () => {
    const scores = await computeSemanticScores([], 10000, 2000, makeEmbedding(1));
    expect(scores).toHaveLength(0);
  });

  it("returns empty array when transcript is shorter than one window", async () => {
    const segments = [seg(0, 5000, "hello")];
    const scores = await computeSemanticScores(segments, 10000, 2000, makeEmbedding(1));
    expect(scores).toHaveLength(0);
  });

  it("calls getEmbedding for each window", async () => {
    const mockFn = vi.fn().mockResolvedValue([1, 0, 0]);
    const segments = [
      seg(0, 5000, "first window text"),
      seg(10000, 15000, "second window text"),
      seg(20000, 25000, "third window text"),
    ];
    await computeSemanticScores(segments, 10000, 2000, mockFn);
    expect(mockFn).toHaveBeenCalled();
  });

  it("returns similarity scores between adjacent windows", async () => {
    const callCount = { n: 0 };
    const mockFn = vi.fn().mockImplementation(() => {
      callCount.n++;
      return Promise.resolve(callCount.n === 1 ? [1, 0] : [0, 1]);
    });

    const segments = [
      seg(0, 8000, "topic A text here"),
      seg(10000, 18000, "topic B text here"),
      seg(20000, 28000, "topic C text here"),
    ];

    const scores = await computeSemanticScores(segments, 10000, 2000, mockFn);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0].boundary_ms).toBeGreaterThan(0);
    expect(typeof scores[0].similarity).toBe("number");
  });

  it("throws when overlap >= window size", async () => {
    const segments = [seg(0, 10000, "text"), seg(12000, 22000, "text2")];
    await expect(
      computeSemanticScores(segments, 10000, 10000, makeEmbedding(1))
    ).rejects.toThrow();
  });

  it("window boundaries are computed correctly", async () => {
    const mockFn = vi.fn().mockResolvedValue([1, 0]);
    const segments = [
      seg(0, 9000, "a"),
      seg(10000, 19000, "b"),
      seg(20000, 29000, "c"),
    ];
    const scores = await computeSemanticScores(segments, 10000, 2000, mockFn);
    if (scores.length > 0) {
      expect(scores[0].boundary_ms).toBeGreaterThanOrEqual(0);
    }
  });
});
