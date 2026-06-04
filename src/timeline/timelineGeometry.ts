/*
 * Editor timeline geometry: row layout + clip positioning. Builds on the
 * ported layout constants (GUTTER, RULER_H) so asset-drop math from layout.ts
 * lines up with what is drawn here.
 */

import { GUTTER, RULER_H } from "./layout";
import { TRACK, type TimelineEvent, type TimelineEventKind } from "../project/types";

export { GUTTER, RULER_H };
/** Editor row height (compact vs. the 72px Hyperframes studio track). */
export const ROW_H = 44;

export interface TimelineRow {
  key: string;
  label: string;
  trackIndex: number;
  kind: "video" | "clips";
}

/** Track-row order, top → bottom, per the spec Timeline Layout. */
export function buildTimelineRows(events: TimelineEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [
    { key: "video", label: "V1", trackIndex: TRACK.video, kind: "video" },
    { key: "cc", label: "CC", trackIndex: TRACK.captions, kind: "clips" },
    { key: "mg", label: "MG", trackIndex: TRACK.motionGraphics, kind: "clips" },
    { key: "img", label: "IMG", trackIndex: TRACK.images, kind: "clips" },
  ];

  // One row per player-image overlay (track >= imageOverlayBase), labelled by
  // the player. Inserted between the generic IMG row and CH.
  const imageTracks = [
    ...new Set(events.filter((e) => e.track >= TRACK.imageOverlayBase).map((e) => e.track)),
  ].sort((a, b) => a - b);
  imageTracks.forEach((track, i) => {
    const ev = events.find((e) => e.track === track);
    const name = ev?.label?.trim();
    rows.push({
      key: `img_${track}`,
      label: name ? `▣ ${name.length > 9 ? name.slice(0, 8) + "…" : name}` : `IMG ${i + 1}`,
      trackIndex: track,
      kind: "clips",
    });
  });

  rows.push({ key: "ch", label: "CH", trackIndex: TRACK.chapters, kind: "clips" });

  const shortTracks = [
    ...new Set(events.filter((e) => e.track >= TRACK.shortsBase).map((e) => e.track)),
  ].sort((a, b) => a - b);
  shortTracks.forEach((track, i) => {
    rows.push({ key: `short_${track}`, label: `S${i + 1}`, trackIndex: track, kind: "clips" });
  });

  return rows;
}

export function clipLeft(start: number, pixelsPerSecond: number): number {
  return GUTTER + Math.max(0, start) * pixelsPerSecond;
}

export function clipWidth(duration: number, pixelsPerSecond: number): number {
  return Math.max(3, duration * pixelsPerSecond);
}

/** Track ids in row order — used as trackOrder for vertical drag math. */
export function trackOrderFromRows(rows: TimelineRow[]): number[] {
  return rows.map((r) => r.trackIndex);
}

/** Spec track colours. */
export const KIND_COLOUR: Record<TimelineEventKind, string> = {
  cut: "#e74c3c",
  caption: "#e0a020",
  motion_graphic: "#3B82F6",
  image: "#22C55E",
  meme: "#22C55E",
  chapter: "#27ae60",
  short_in: "#9b59b6",
  short_out: "#9b59b6",
  transition: "#888888",
};
