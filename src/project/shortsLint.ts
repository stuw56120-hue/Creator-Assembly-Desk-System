/*
 * Pre-render lint for Shorts Schema v2 (SS-6). Catches problems that would make
 * a short render badly BEFORE FFmpeg runs, with plain-English messages (for
 * Stuart, not stack traces). Errors block the render; warnings are advisory.
 *
 * Pure — no Node/FFmpeg. The render handler builds the inputs (segment timing +
 * the visible caption/overlay spans on the assembled timeline) and calls this
 * before spending time on a render.
 *
 * "Visual coverage" = the fraction of the assembled runtime during which a
 * caption OR an overlay is on screen. Shorts should stay visually busy; a low
 * value usually means missing captions or large bare stretches. NOTE: this is a
 * RENDER-time check because captions (the main visual element) are generated
 * from the VTT at render time, not at parse time.
 */

/** Per-second cap on a single segment. */
export const MAX_SEGMENT_SECONDS = 10;
/** Minimum fraction of runtime that must show a caption or overlay. */
export const MIN_VISUAL_COVERAGE = 0.7;

export interface LintOverlay {
  motionGraphicId?: string;
  appearAtSeconds: number;
  durationSeconds: number;
}

export interface LintSegment {
  segmentId: string;
  inSeconds: number;
  outSeconds: number;
  overlays: LintOverlay[];
}

export interface ShortsLintInput {
  segments: LintSegment[];
  /** Assembled-timeline [start,end] spans where a caption or overlay is visible. */
  visibleSpans: { start: number; end: number }[];
}

export interface ShortsLintResult {
  errors: string[];
  warnings: string[];
  coverage: number; // 0–1
}

/** Union length of [start,end] spans (overlaps merged), clamped to [0,total], / total. */
export function coverageFraction(spans: { start: number; end: number }[], total: number): number {
  if (total <= 0) return 0;
  const clamped = spans
    .map((s) => ({ start: Math.max(0, Math.min(total, s.start)), end: Math.max(0, Math.min(total, s.end)) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  let cursor = 0;
  for (const s of clamped) {
    const start = Math.max(s.start, cursor);
    if (s.end > start) {
      covered += s.end - start;
      cursor = s.end;
    }
  }
  return Math.min(1, Number((covered / total).toFixed(4)));
}

/** Pull [start,end] (seconds) spans from the Dialogue lines of an ASS subtitle string. */
export function assDialogueSpans(ass: string): { start: number; end: number }[] {
  const t = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);
  const spans: { start: number; end: number }[] = [];
  for (const line of ass.split(/\r?\n/)) {
    const m = line.match(/^Dialogue: \d+,(\d+):(\d{2}):(\d{2}\.\d{2}),(\d+):(\d{2}):(\d{2}\.\d{2})/);
    if (m) spans.push({ start: t(m[1], m[2], m[3]), end: t(m[4], m[5], m[6]) });
  }
  return spans;
}

/**
 * Build the visible-coverage spans (captions ∪ overlays) on the ASSEMBLED
 * timeline, for the lint's coverage check. Each segment's overlays are offset to
 * that segment's cumulative start; the hook sits at t=0 and the CTA over the
 * tail of the assembled short.
 */
export function assembledVisibleSpans(input: {
  segments: { inSeconds: number; outSeconds: number; overlays?: { appearAtSeconds: number; durationSeconds: number }[] }[];
  hook?: { durationSeconds: number };
  cta?: { durationSeconds: number };
  captionSpans: { start: number; end: number }[];
}): { start: number; end: number }[] {
  const spans = [...input.captionSpans];
  let offset = 0;
  for (const seg of input.segments) {
    for (const ov of seg.overlays ?? []) {
      spans.push({ start: offset + ov.appearAtSeconds, end: offset + ov.appearAtSeconds + ov.durationSeconds });
    }
    offset += Math.max(0, seg.outSeconds - seg.inSeconds);
  }
  const total = offset;
  if (input.hook) spans.push({ start: 0, end: input.hook.durationSeconds });
  if (input.cta) spans.push({ start: Math.max(0, total - input.cta.durationSeconds), end: total });
  return spans;
}

/**
 * Lint an assembled short before rendering. Returns blocking errors, advisory
 * warnings, and the computed visual-coverage fraction. The handler must NOT
 * render when `errors` is non-empty.
 */
export function lintShortRender(input: ShortsLintInput): ShortsLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const segs = input.segments;
  const total = segs.reduce((acc, s) => acc + Math.max(0, s.outSeconds - s.inSeconds), 0);

  if (segs.length === 0) {
    errors.push("This short has no segments to render.");
    return { errors, warnings, coverage: 0 };
  }

  // No segment over 10s.
  for (const s of segs) {
    const dur = s.outSeconds - s.inSeconds;
    if (dur > MAX_SEGMENT_SECONDS + 1e-6) {
      errors.push(
        `Segment ${s.segmentId} is ${dur.toFixed(1)}s long — short segments must be ${MAX_SEGMENT_SECONDS}s or less. Trim it before rendering.`,
      );
    }
  }

  // Each overlay must finish inside its own segment.
  for (const s of segs) {
    const dur = Math.max(0, s.outSeconds - s.inSeconds);
    for (const ov of s.overlays) {
      const end = (ov.appearAtSeconds ?? 0) + ov.durationSeconds;
      if (end > dur + 1e-6) {
        errors.push(
          `In segment ${s.segmentId}, an overlay${ov.motionGraphicId ? ` (${ov.motionGraphicId})` : ""} ends at ${end.toFixed(1)}s but the segment is only ${dur.toFixed(1)}s long. Shorten the overlay or lengthen the segment.`,
        );
      }
    }
  }

  // Visual coverage ≥ 70%.
  const coverage = coverageFraction(input.visibleSpans, total);
  if (coverage + 1e-6 < MIN_VISUAL_COVERAGE) {
    errors.push(
      `Only ${Math.round(coverage * 100)}% of this short has a caption or graphic on screen — shorts should stay visually busy (at least ${Math.round(
        MIN_VISUAL_COVERAGE * 100,
      )}%). Add captions or overlays, or trim the bare stretches.`,
    );
  }

  return { errors, warnings, coverage };
}
