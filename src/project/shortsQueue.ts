/*
 * Helpers for the shorts approval queue (Step 8): list the short clips and
 * gather the enabled, built overlays that fall within a short's span so they
 * can be composited into the vertical render.
 */

import type { RenderOverlayInput } from "./renderExporter";
import type { TimelineEvent } from "./types";

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
