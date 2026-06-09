import { describe, expect, it } from "vitest";
import {
  assDialogueSpans,
  assembledVisibleSpans,
  coverageFraction,
  lintShortRender,
  MAX_SEGMENT_SECONDS,
} from "./shortsLint";

describe("coverageFraction", () => {
  it("merges overlapping spans and divides by total", () => {
    // [0,4] ∪ [3,6] = [0,6] = 6 of 10 → 0.6
    expect(coverageFraction([{ start: 0, end: 4 }, { start: 3, end: 6 }], 10)).toBeCloseTo(0.6, 3);
  });
  it("clamps spans to [0,total] and returns 0 for empty", () => {
    expect(coverageFraction([{ start: -5, end: 15 }], 10)).toBe(1);
    expect(coverageFraction([], 10)).toBe(0);
    expect(coverageFraction([{ start: 0, end: 5 }], 0)).toBe(0);
  });
});

describe("lintShortRender (SS-6 pre-render lint)", () => {
  const seg = (id: string, inS: number, outS: number, overlays: { motionGraphicId?: string; appearAtSeconds: number; durationSeconds: number }[] = []) => ({
    segmentId: id,
    inSeconds: inS,
    outSeconds: outS,
    overlays,
  });
  // 4 × 5s = 20s assembled.
  const goodSegs = [seg("s1", 0, 5), seg("s2", 10, 15), seg("s3", 20, 25), seg("s4", 30, 35)];
  const fullCoverage = [{ start: 0, end: 20 }]; // captions span the whole thing

  it("passes a clean short with full coverage", () => {
    const r = lintShortRender({ segments: goodSegs, visibleSpans: fullCoverage });
    expect(r.errors).toEqual([]);
    expect(r.coverage).toBe(1);
  });

  it("blocks a segment longer than 10s", () => {
    const r = lintShortRender({ segments: [seg("s1", 0, 12), seg("s2", 20, 25), seg("s3", 30, 35), seg("s4", 40, 45)], visibleSpans: [{ start: 0, end: 27 }] });
    expect(r.errors.some((e) => e.includes(`s1 is 12.0s`) && e.includes(`${MAX_SEGMENT_SECONDS}s or less`))).toBe(true);
  });

  it("blocks an overlay that runs past its segment", () => {
    const r = lintShortRender({
      segments: [seg("s1", 0, 5, [{ motionGraphicId: "quote_card", appearAtSeconds: 3, durationSeconds: 4 }]), seg("s2", 10, 15), seg("s3", 20, 25), seg("s4", 30, 35)],
      visibleSpans: fullCoverage,
    });
    expect(r.errors.some((e) => e.includes("s1") && e.includes("quote_card") && e.includes("only 5.0s"))).toBe(true);
  });

  it("blocks a short with under 70% visual coverage", () => {
    // captions cover only 10 of 20s → 50%
    const r = lintShortRender({ segments: goodSegs, visibleSpans: [{ start: 0, end: 10 }] });
    expect(r.coverage).toBeCloseTo(0.5, 3);
    expect(r.errors.some((e) => e.includes("50% of this short") && e.includes("at least 70%"))).toBe(true);
  });

  it("accepts exactly 70% coverage", () => {
    const r = lintShortRender({ segments: goodSegs, visibleSpans: [{ start: 0, end: 14 }] }); // 14/20 = 70%
    expect(r.errors).toEqual([]);
  });
});

describe("assDialogueSpans", () => {
  it("parses Dialogue start/end seconds and ignores non-dialogue lines", () => {
    const ass = ["[Events]", "Dialogue: 0,0:00:01.50,0:00:03.00,Shorts,,0,0,0,,{\\k50}hi", "Comment: ignored", "Dialogue: 0,0:00:07.00,0:00:09.25,Shorts,,0,0,0,,bye"].join("\n");
    expect(assDialogueSpans(ass)).toEqual([{ start: 1.5, end: 3 }, { start: 7, end: 9.25 }]);
  });
  it("returns [] for a caption-free string", () => {
    expect(assDialogueSpans("")).toEqual([]);
  });
});

describe("assembledVisibleSpans", () => {
  it("offsets overlays to each segment's assembled start and anchors hook/CTA", () => {
    const spans = assembledVisibleSpans({
      // seg0 [0,5), seg1 [5,11) on the assembled timeline
      segments: [
        { inSeconds: 0, outSeconds: 5, overlays: [{ appearAtSeconds: 1, durationSeconds: 2 }] }, // → 1..3
        { inSeconds: 100, outSeconds: 106, overlays: [{ appearAtSeconds: 0, durationSeconds: 1 }] }, // → 5..6
      ],
      hook: { durationSeconds: 3 }, // → 0..3
      cta: { durationSeconds: 2 }, // total 11 → 9..11
      captionSpans: [{ start: 0, end: 11 }],
    });
    expect(spans).toEqual([
      { start: 0, end: 11 }, // caption
      { start: 1, end: 3 }, // seg0 overlay
      { start: 5, end: 6 }, // seg1 overlay at offset 5
      { start: 0, end: 3 }, // hook
      { start: 9, end: 11 }, // cta over the tail
    ]);
  });
  it("omits hook/CTA spans when not supplied", () => {
    const spans = assembledVisibleSpans({ segments: [{ inSeconds: 0, outSeconds: 5 }], captionSpans: [] });
    expect(spans).toEqual([]);
  });
});
