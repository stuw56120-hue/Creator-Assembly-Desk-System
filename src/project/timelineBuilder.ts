/*
 * C.A.D.S. timeline builder.
 *
 * Converts a validated edit list into the typed TimelineEvent stream the editor
 * renders, and computes the "keep" segments (the complement of enabled cuts).
 * Motion graphics are created with buildStatus "pending" — the asset is built
 * later (Step 8 pipeline). All times are SOURCE video seconds.
 */

import { motionOverlayToParams, type EditList, type PlayerImageOverlay } from "./editListParser";
import { playerAssetId, playerOverlayRole } from "./playerAssets";
import { isValidTimecode, parseTimecode } from "./timecode";
import { TRACK, type KeepSegment, type TimelineEvent } from "./types";

/** Fallback on-screen time for a player image whose overlay omits a duration. */
const DEFAULT_IMAGE_DURATION_SECONDS = 5;

export interface BuiltTimeline {
  events: TimelineEvent[];
  keepSegments: KeepSegment[];
}

/**
 * Compute the retained spans of the source video: the whole [0, duration]
 * range minus the union of enabled cut regions. Disabled cuts are ignored
 * (cuts are toggled off, never deleted — FFmpeg only sees enabled cuts).
 */
export function buildKeepSegments(
  durationSeconds: number,
  cutEvents: TimelineEvent[],
): KeepSegment[] {
  const removed = cutEvents
    .filter((e) => e.kind === "cut" && e.enabled)
    .map((e) => ({ start: e.start, end: e.start + e.duration }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping/touching removed regions.
  const merged: { start: number; end: number }[] = [];
  for (const r of removed) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  const segments: KeepSegment[] = [];
  let cursor = 0;
  for (const r of merged) {
    const clampedStart = Math.max(0, Math.min(r.start, durationSeconds));
    if (clampedStart > cursor) segments.push({ start: cursor, end: clampedStart });
    cursor = Math.max(cursor, Math.min(r.end, durationSeconds));
  }
  if (cursor < durationSeconds) segments.push({ start: cursor, end: durationSeconds });
  return segments;
}

/** A hook still awaiting a real spoken line (customGPT placeholder). */
const HOOK_PLACEHOLDER = /TRANSCRIPT[_ ]?REQUIRED/i;

function shortNeedsReview(hook: string): boolean {
  return hook.trim() === "" || HOOK_PLACEHOLDER.test(hook);
}

/**
 * Build the image overlay events from the customGPT's player_image_overlays.
 *
 * Each overlay that carries a time becomes an "image" event on the images track.
 * `overlayData.assetId` is the SAME id the onboarding screen derives for that
 * (player × role), so once the user uploads (or the library resolves) the image,
 * applyOnboardedImagesToTimeline can fill in `assetPath` and the picture shows in
 * the preview. Overlays with no time are upload-slot hints only (they still drive
 * onboarding via required_assets) and produce no timeline event.
 */
/** The four-quadrant grid players are auto-placed into when no quadrant is given. */
const QUADRANT_CYCLE = ["top_left", "top_right", "bottom_left", "bottom_right"];

/** Normalised CENTRE point for a placement keyword (x,y in 0–1). */
function placementToXY(placement: string): { x: number; y: number } {
  // Corner placements have the HORIZONTAL inset halved so images sit closer to
  // the left/right edges (0.235 / 0.765 vs the previous 0.27 / 0.73). Vertical
  // insets (0.3 / 0.7) stay so captions in the lower third don't collide.
  // Side placements (left_center / right_center) keep their original inset.
  switch (placement) {
    case "top_left":
    case "upper_left":
      return { x: 0.235, y: 0.3 };
    case "top_right":
    case "upper_right":
      return { x: 0.765, y: 0.3 };
    case "bottom_left":
    case "lower_left":
      return { x: 0.235, y: 0.7 };
    case "bottom_right":
    case "lower_right":
      return { x: 0.765, y: 0.7 };
    case "left_center":
      return { x: 0.27, y: 0.5 };
    case "right_center":
      return { x: 0.73, y: 0.5 };
    case "top_center":
      return { x: 0.5, y: 0.3 };
    case "bottom_center":
      return { x: 0.5, y: 0.7 };
    default:
      return { x: 0.5, y: 0.5 };
  }
}

const QUADRANT_PLACEMENTS = new Set([
  "top_left", "top_right", "bottom_left", "bottom_right",
  "upper_left", "upper_right", "lower_left", "lower_right",
  "left_center", "right_center", "top_center", "bottom_center", "center",
]);

/** Placement for a player image: an explicit quadrant field, else auto-assigned. */
function resolveImagePlacement(overlay: Record<string, unknown>, placedIndex: number): string {
  for (const key of ["placement", "position", "quadrant", "screen_position"]) {
    const v = overlay[key];
    if (typeof v === "string" && QUADRANT_PLACEMENTS.has(v.trim())) return v.trim();
  }
  // No usable position → spread across the four-quadrant grid (avoids stacking).
  return QUADRANT_CYCLE[placedIndex % QUADRANT_CYCLE.length];
}

function buildImageOverlayEvents(overlays: PlayerImageOverlay[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let placed = 0; // counts only overlays that become events (for track + quadrant)
  overlays.forEach((overlay, index) => {
    const subject = (overlay.image_subject ?? "").trim();
    // The customGPT uses `appear_time`; `time` is accepted as an alias.
    const startTimecode = overlay.appear_time ?? overlay.time;
    // No subject → can't link to an upload slot; no time → can't place it.
    if (!subject || !startTimecode || !isValidTimecode(startTimecode)) return;

    const role = playerOverlayRole(overlay as Record<string, unknown>);
    const start = parseTimecode(startTimecode);
    const durationValue = overlay.duration_seconds ?? overlay.appear_duration_seconds;
    const duration =
      typeof durationValue === "number" && durationValue > 0
        ? durationValue
        : DEFAULT_IMAGE_DURATION_SECONDS;
    const id = overlay.overlay_id || `img_${playerAssetId(subject, role)}_${index}`;
    const placement = resolveImagePlacement(overlay as Record<string, unknown>, placed);
    const { x, y } = placementToXY(placement);

    events.push({
      id,
      kind: "image",
      label: overlay.text?.trim() || subject,
      start,
      duration,
      // Own row per overlay so the timeline shows them stacked vertically.
      track: TRACK.imageOverlayBase + placed,
      enabled: true,
      locked: false,
      // A player image with no uploaded asset yet still needs review (its
      // placeholder shows in the preview until the picture is collected).
      reviewRequired: false,
      confidence: 1,
      overlayData: {
        assetPath: "", // filled by applyOnboardedImagesToTimeline once collected
        assetId: playerAssetId(subject, role),
        placement,
        // Seed the free-position centre from the quadrant; the user can drag /
        // resize in the preview, which overwrites x/y/width (and persists).
        x,
        y,
        width: 0.4,
        opacity: 1,
        // Fades (seconds) — the preview eases opacity in/out over these windows.
        fadeInSeconds:
          typeof overlay.fade_in_duration_seconds === "number" && overlay.fade_in_duration_seconds > 0
            ? overlay.fade_in_duration_seconds
            : undefined,
        fadeOutSeconds:
          typeof overlay.fade_out_duration_seconds === "number" && overlay.fade_out_duration_seconds > 0
            ? overlay.fade_out_duration_seconds
            : undefined,
      },
    });
    placed++;
  });
  return events;
}

export function buildTimeline(editList: EditList): BuiltTimeline {
  const events: TimelineEvent[] = [];
  const lf = editList.longform;

  // ── Cuts (V1) ──────────────────────────────────────────────────────────
  for (const cut of lf.cuts) {
    const start = parseTimecode(cut.start_time);
    // Fall back to (end - start) when the customGPT omits remove_duration_seconds.
    const removeSeconds =
      cut.remove_duration_seconds ?? Math.max(0, parseTimecode(cut.end_time) - start);
    events.push({
      id: cut.cut_id,
      kind: "cut",
      label: `Trim · ${removeSeconds.toFixed(1)}s`,
      start,
      duration: removeSeconds,
      track: TRACK.video,
      enabled: true,
      locked: cut.locked_against_gpt_override,
      reviewRequired: cut.review_required,
      confidence: cut.confidence,
      cutData: {
        removeSeconds,
        preserveIf: cut.preserve_if,
        silenceDurationSeconds: cut.silence_duration_seconds ?? removeSeconds,
      },
    });
  }

  // ── Motion graphics (MG) — from longform.motion_overlays, pending ───────
  for (const overlay of lf.motion_overlays) {
    const start = parseTimecode(overlay.time);
    events.push({
      id: overlay.overlay_id,
      kind: "motion_graphic",
      label: overlay.text ?? overlay.motion_graphic_id,
      start,
      duration: overlay.duration_seconds,
      track: TRACK.motionGraphics,
      enabled: true,
      locked: false,
      reviewRequired: false,
      confidence: overlay.confidence,
      overlayData: {
        assetPath: "", // populated when the WebM is built
        assetId: overlay.overlay_id,
        placement: overlay.placement,
        x: 0.5,
        y: 0.5,
        width: 0.4,
        opacity: 1,
      },
      motionGraphicData: {
        templateId: overlay.motion_graphic_id,
        params: motionOverlayToParams(overlay as Record<string, unknown>),
        buildStatus: "pending",
        mgId: overlay.overlay_id,
      },
    });
  }

  // ── Transitions ─────────────────────────────────────────────────────────
  for (const tr of lf.transitions) {
    events.push({
      id: tr.transition_id,
      kind: "transition",
      label: tr.transition,
      start: parseTimecode(tr.time),
      duration: 0,
      track: TRACK.video,
      enabled: true,
      locked: false,
      reviewRequired: false,
      confidence: tr.confidence,
    });
  }

  // ── Chapters (CH) ───────────────────────────────────────────────────────
  for (const ch of lf.chapters) {
    events.push({
      id: ch.chapter_id,
      kind: "chapter",
      label: ch.title,
      start: parseTimecode(ch.start_time),
      duration: 0,
      track: TRACK.chapters,
      enabled: true,
      locked: false,
      // A chapter still labelled "Segment NN" needs a human title before approval.
      reviewRequired: ch.requires_transcript_label,
      confidence: ch.confidence,
      chapterData: {
        requiresTranscriptLabel: ch.requires_transcript_label,
        detectionSource: ch.detection_source,
      },
    });
  }

  // ── Shorts (S1–S4) — one span row each ──────────────────────────────────
  // Handles both schemas: v1 (start_time/end_time + string hook) and Shorts
  // Schema v2 (segments[] + object hook). For a v2 short the timeline marker
  // starts at the first segment and spans the assembled length (segments are
  // non-contiguous in the source); the SS-5 inspector replaces this with a real
  // per-segment view.
  editList.shorts.forEach((short, index) => {
    const segments = Array.isArray(short.segments) ? short.segments : [];
    const hookText = typeof short.hook === "string" ? short.hook : short.hook?.text ?? "";
    let start: number;
    let duration: number;
    if (segments.length > 0) {
      start = parseTimecode(segments[0].start_time);
      duration = segments.reduce(
        (acc, s) => acc + Math.max(0, parseTimecode(s.end_time) - parseTimecode(s.start_time)),
        0,
      );
    } else {
      start = short.start_time ? parseTimecode(short.start_time) : 0;
      const out = short.end_time ? parseTimecode(short.end_time) : start;
      duration = Math.max(0, out - start);
    }
    events.push({
      id: short.short_id,
      kind: "short_in",
      label: hookText.trim() || short.title || short.short_id,
      start,
      duration,
      track: TRACK.shortsBase + index,
      enabled: true,
      locked: false,
      reviewRequired: shortNeedsReview(hookText),
      confidence: short.confidence,
      shortData: {
        shortId: short.short_id,
        hook: hookText,
        captionStyle: short.caption_style,
        aspectRatio: short.framing?.aspect_ratio ?? "9:16",
        notes: short.notes,
      },
    });
  });

  // ── Player image overlays → image events ────────────────────────────────
  // Read top-level and (defensively) longform, matching the parser's merge.
  const playerOverlays: PlayerImageOverlay[] = [
    ...editList.player_image_overlays,
    ...((editList.longform as { player_image_overlays?: PlayerImageOverlay[] })
      .player_image_overlays ?? []),
  ];
  events.push(...buildImageOverlayEvents(playerOverlays));

  const keepSegments = buildKeepSegments(editList.metadata.duration_seconds, events);
  return { events, keepSegments };
}
