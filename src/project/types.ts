/*
 * C.A.D.S. core timeline data model.
 *
 * TimelineEvent is reproduced from the C.A.D.S. v2 specification ("Core Data
 * Model"). All timeline coordinates are SOURCE video seconds; output timecodes
 * are computed only at render time (per spec constraints).
 */

export type TimelineEventKind =
  | "cut" // silence/dead-air trim
  | "chapter" // chapter boundary marker
  | "caption" // editable transcript caption segment
  | "motion_graphic" // Hyperframes-built WebM overlay
  | "image" // still image from library
  | "meme" // meme/reaction image
  | "short_in" // short clip in-point (used here as the short's span)
  | "short_out" // short clip out-point (reserved)
  | "transition";

export type MotionGraphicBuildStatus = "pending" | "building" | "ready" | "error";

export interface CutData {
  removeSeconds: number;
  preserveIf: string[];
  silenceDurationSeconds: number;
}

/** Shared by image, meme, and motion_graphic overlays. */
export interface OverlayData {
  assetPath: string; // absolute path to WebM or image ("" until built)
  assetId: string;
  placement: string;
  x: number; // normalised 0-1
  y: number;
  width: number;
  opacity: number;
  /** Player-image fades (seconds). Absent → hard cut in/out. */
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  /** Entry animation: none | fade | slide_in_left | slide_in_right | pop_in (default fade). */
  entry?: string;
  /** Exit animation: none | fade | slide_out_left | slide_out_right (default fade). */
  exit?: string;
}

export interface MotionGraphicData {
  templateId: string;
  params: Record<string, unknown>; // editable in the Inspector
  buildStatus: MotionGraphicBuildStatus;
  mgId: string;
}

export interface ChapterData {
  requiresTranscriptLabel: boolean;
  detectionSource: string;
  /**
   * Normalised top-left anchor (0–1 of the frame) of the chapter title card in
   * the preview. Defaults to the top-left corner when unset; the user can drag
   * the card to reposition it, which persists here.
   */
  x?: number;
  y?: number;
}

export interface ShortData {
  shortId: string;
  hook: string;
  captionStyle: string;
  aspectRatio: string;
  notes: string[];
}

/** A transcript caption segment (editable in the Caption Editor). */
export interface CaptionData {
  speaker: string;
  text: string;
}

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  label: string;
  start: number; // source video seconds
  duration: number;
  track: number;
  enabled: boolean;
  locked: boolean;
  reviewRequired: boolean;
  confidence: number;

  cutData?: CutData;
  overlayData?: OverlayData; // image, meme, motion_graphic
  motionGraphicData?: MotionGraphicData; // only when kind === "motion_graphic"
  chapterData?: ChapterData;
  shortData?: ShortData;
  captionData?: CaptionData; // only when kind === "caption"
}

/** A retained span of the source video (the complement of enabled cuts). */
export interface KeepSegment {
  start: number; // source seconds (inclusive)
  end: number; // source seconds (exclusive)
}

/* ── Track layout ─────────────────────────────────────────────────────────
 * Row order top→bottom per the spec's Timeline Layout. Shorts get one row
 * each (S1–S4), starting at SHORTS_TRACK_BASE.
 */
export const TRACK = {
  video: 0,
  captions: 1,
  motionGraphics: 2,
  images: 3, // generic image row (library drops)
  chapters: 4,
  shortsBase: 5,
  /**
   * Player-image overlays each get their OWN row at imageOverlayBase + n, kept
   * high so they never collide with chapters/shorts. Row vertical position is by
   * array order (see buildTimelineRows), so the large track numbers only need to
   * be distinct, not contiguous with the others.
   */
  imageOverlayBase: 100,
} as const;
