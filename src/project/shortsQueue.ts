/*
 * Helpers for the shorts approval queue (Step 8): list the short clips and
 * gather the enabled, built overlays that fall within a short's span so they
 * can be composited into the vertical render.
 */

import type { RenderOverlayInput } from "./renderExporter";
import type { VttWord } from "./shortsCaptions";
import type { ShortData, TimelineEvent } from "./types";

export interface ShortCaptionIpcInput {
  sourceStart: number;
  duration: number;
  text: string;
}

const OVERLAY_KINDS = new Set<TimelineEvent["kind"]>(["motion_graphic", "image", "meme"]);

/** Short clips, in chronological order. */
export function listShorts(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((e) => e.kind === "short_in").sort((a, b) => a.start - b.start);
}

/**
 * Enabled overlays with a built asset whose start lies within [start, end).
 * Returned in render-overlay form (source-relative; the render maps to
 * short-local time).
 */
export function overlaysWithinSpan(
  events: TimelineEvent[],
  start: number,
  end: number,
): RenderOverlayInput[] {
  return events
    .filter(
      (e) =>
        e.enabled &&
        OVERLAY_KINDS.has(e.kind) &&
        e.overlayData?.assetPath &&
        e.start >= start &&
        e.start < end,
    )
    .map((e) => ({
      inputPath: e.overlayData!.assetPath,
      sourceStart: e.start,
      duration: e.duration,
      placement: e.overlayData!.placement,
      ...(e.kind === "image"
        ? { x: e.overlayData!.x, y: e.overlayData!.y, width: e.overlayData!.width }
        : {}),
      fullFrame: e.kind === "motion_graphic",
      opacity: e.overlayData!.opacity,
    }));
}

/** Enabled caption events whose SOURCE start lies within [start, end). */
export function captionsWithinSpan(
  events: TimelineEvent[],
  start: number,
  end: number,
): ShortCaptionIpcInput[] {
  return events
    .filter(
      (e) =>
        e.kind === "caption" &&
        e.enabled &&
        (e.captionData?.text ?? "").trim() !== "" &&
        e.start >= start &&
        e.start < end,
    )
    .map((e) => ({ sourceStart: e.start, duration: e.duration, text: e.captionData!.text }));
}

/* ── Shorts Schema v2 render plan (SS-6) ──────────────────────────────────── */

/** One segment as it crosses the IPC boundary to the v2 render handler. */
export interface ShortV2SegmentInput {
  inSeconds: number;
  outSeconds: number;
  energy?: string;
  transitionIn?: string;
  transitionOut?: string;
  overlays?: { inputPath: string; appearAtSeconds: number; durationSeconds: number }[];
  emphasis?: string[];
}

export interface ShortV2RenderPlan {
  sourcePath: string;
  segments: ShortV2SegmentInput[];
  captionWords: VttWord[];
  captionStyle?: string;
  quality: "proxy" | "full";
  defaultName: string;
}

/**
 * Word-level caption timing for the v2 caption builder, derived from the
 * project's caption events. Whisper gives us line-level cues (not per-word), so
 * each line's duration is split evenly across its words — the same approximation
 * parseVttWords makes for a VTT cue. The v2 builder then filters/offsets these
 * per segment, so passing ALL caption words is correct.
 */
export function captionWordsFromEvents(events: TimelineEvent[]): VttWord[] {
  const words: VttWord[] = [];
  for (const e of events) {
    if (e.kind !== "caption" || !e.enabled) continue;
    const text = (e.captionData?.text ?? "").trim();
    if (!text) continue;
    const tokens = text.split(/\s+/);
    const per = e.duration / tokens.length;
    tokens.forEach((t, i) => {
      words.push({ text: t, start: e.start + i * per, end: e.start + (i + 1) * per });
    });
  }
  return words;
}

/**
 * Map a built motion-graphic's id → its asset path, so a segment overlay (which
 * references a motion_graphic_id) can be resolved to the WebM on disk. Keyed by
 * both the template id and the instance id; only events with a built asset are
 * included.
 */
export function mgPathById(events: TimelineEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of events) {
    if (e.kind !== "motion_graphic") continue;
    const path = e.overlayData?.assetPath;
    if (!path) continue;
    const mg = e.motionGraphicData;
    if (mg?.templateId) map.set(mg.templateId, path);
    if (mg?.mgId) map.set(mg.mgId, path);
  }
  return map;
}

/**
 * Build the v2 render plan for one short: map its segments (resolving each
 * segment overlay's motion_graphic_id to a built asset — unresolved overlays are
 * dropped so a missing MG never blocks the render) and attach caption words +
 * style. The handler runs the pre-render lint and renders proxy or full.
 */
export function shortV2RenderPlan(args: {
  shortData: ShortData;
  events: TimelineEvent[];
  sourcePath: string;
  captionStyle?: string;
  quality: "proxy" | "full";
  defaultName: string;
}): ShortV2RenderPlan {
  const mgMap = mgPathById(args.events);
  const segments: ShortV2SegmentInput[] = args.shortData.segments.map((seg) => ({
    inSeconds: seg.inSeconds,
    outSeconds: seg.outSeconds,
    energy: seg.energy,
    transitionIn: seg.transitionIn,
    transitionOut: seg.transitionOut,
    overlays: seg.overlays
      .map((o) => {
        const inputPath = mgMap.get(o.motionGraphicId);
        return inputPath
          ? { inputPath, appearAtSeconds: o.appearAtSeconds, durationSeconds: o.durationSeconds }
          : null;
      })
      .filter((o): o is { inputPath: string; appearAtSeconds: number; durationSeconds: number } => o !== null),
    emphasis: seg.captionEmphasis,
  }));
  return {
    sourcePath: args.sourcePath,
    segments,
    captionWords: captionWordsFromEvents(args.events),
    captionStyle: args.captionStyle,
    quality: args.quality,
    defaultName: args.defaultName,
  };
}
