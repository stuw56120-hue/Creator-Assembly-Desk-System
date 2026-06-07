/*
 * C.A.D.S. edit list parser.
 *
 * Validates the JSON the customGPT produces (file or pasted text) with Zod,
 * then validates each motion graphic against the template registry and queues a
 * build job for every valid one. Unknown template ids and bad params surface as
 * errors.
 *
 * This schema matches the REAL Sweet Relief edit list contract:
 *   { edit_list_version, project_type, project_name, metadata, longform, shorts }
 * where motion graphics live in `longform.motion_overlays`, each keyed by a
 * `motion_graphic_id` (the template) with flattened content fields (text,
 * placement, …) rather than a nested params object. Schemas use .passthrough()
 * so unanticipated fields survive a round-trip.
 */

import { z } from "zod";
import { isValidTimecode, parseTimecode } from "./timecode";
import { mergeRequiredAssets, requiredAssetsFromPlayerOverlays } from "./playerAssets";

/* ── Template registry (injected; built for real in Step 6) ─────────────── */
export type TemplateParamType = "string" | "color" | "enum" | "number" | "boolean";

export interface TemplateParamSchema {
  type: TemplateParamType;
  required?: boolean;
  default?: unknown;
  values?: string[]; // for enum
}

export interface TemplateDefinition {
  label: string;
  compositionPath: string;
  thumbnail?: string;
  defaultDuration: number;
  params: Record<string, TemplateParamSchema>;
}

export type TemplateRegistry = Record<string, TemplateDefinition>;

/* ── Zod schemas ────────────────────────────────────────────────────────── */
const timecode = z.string().refine(isValidTimecode, {
  message: "Invalid timecode (expected [HH:]MM:SS.s)",
});
const confidence = z.number().min(0).max(1).default(1);

export const CutSchema = z
  .object({
    cut_id: z.string(),
    type: z.string().default("dead_air_trim"),
    source: z.string().optional(),
    start_time: timecode,
    end_time: timecode,
    original_silence_start: timecode.optional(),
    original_silence_end: timecode.optional(),
    silence_duration_seconds: z.number().nonnegative().optional(),
    // Optional: normalization fills it from start/end, and the builder also
    // falls back to (end_time - start_time) when it is absent.
    remove_duration_seconds: z.number().nonnegative().optional(),
    confidence,
    locked_against_gpt_override: z.boolean().default(false),
    review_required: z.boolean().default(false),
    preserve_if: z.array(z.string()).default([]),
  })
  .passthrough();

export const ChapterSchema = z
  .object({
    chapter_id: z.string(),
    title: z.string(),
    start_time: timecode,
    end_time: timecode.optional(),
    detection_source: z.string().default("audio_energy_interval"),
    confidence,
    requires_transcript_label: z.boolean().default(false),
  })
  .passthrough();

export const TransitionSchema = z
  .object({
    transition_id: z.string(),
    time: timecode,
    transition: z.string(),
    purpose: z.string().optional(),
    confidence,
  })
  .passthrough();

// A motion graphic instruction. `motion_graphic_id` references a template;
// remaining content fields (text, placement, …) become the template params.
export const MotionOverlaySchema = z
  .object({
    overlay_id: z.string(),
    time: timecode,
    duration_seconds: z.number().positive(),
    motion_graphic_id: z.string(),
    text: z.string().optional(),
    placement: z.string().default("center"),
    confidence,
  })
  .passthrough();

// Nested overlays inside a short omit overlay_id and may carry a `purpose`.
const NestedMotionOverlaySchema = z
  .object({
    time: timecode,
    duration_seconds: z.number().positive(),
    motion_graphic_id: z.string(),
    text: z.string().optional(),
    placement: z.string().optional(),
    purpose: z.string().optional(),
    confidence,
  })
  .passthrough();

const NestedTransitionSchema = z
  .object({
    time: timecode,
    transition: z.string(),
    confidence,
  })
  .passthrough();

const FramingSchema = z
  .object({
    aspect_ratio: z.string().default("9:16"),
    safe_area: z.string().optional(),
    source_resolution: z.string().optional(),
  })
  .passthrough();

/* ── Shorts Schema v2 (multi-segment) ──────────────────────────────────────
 * A short is now a directed SEQUENCE of independently-timed segments pulled from
 * different points in the source, with a hook, per-segment overlays/transitions,
 * and a closing CTA. The legacy v1 clip shape (start_time/end_time + string
 * hook) is still accepted for backward compatibility but flagged as deprecated
 * by the parser (see validateShort). Spec: docs/CADS_Shorts_Schema_v2.md.
 */

/** v2 caption styles — drives the inspector's option list (SS-5). The schema
 *  accepts any string so legacy v1 styles (e.g. "bold_social") still parse. */
export const SHORT_CAPTION_STYLES_V2 = ["shorts_bold", "shorts_minimal", "shorts_kinetic"] as const;

/** Permitted per-segment transitions. Kept as free strings in the schema (like
 *  longform transitions); the SS-2 renderer maps/handles them. */
export const SHORT_SEGMENT_TRANSITIONS = [
  "cut",
  "smash_cut",
  "punch_zoom",
  "whip_pan",
  "flash_white",
  "none",
] as const;

// One motion-graphic overlay inside a segment / hook / cta. The motion_graphic_id
// is validated against the template registry by parseEditList (like longform).
export const ShortOverlaySchema = z
  .object({
    motion_graphic_id: z.string(),
    params: z.record(z.unknown()).default({}),
    appear_at_seconds: z.number().nonnegative().default(0),
    duration_seconds: z.number().positive(),
  })
  .passthrough();

export const ShortHookSchema = z
  .object({
    text: z.string().default(""),
    overlay: ShortOverlaySchema.optional(),
  })
  .passthrough();

export const ShortCTASchema = z
  .object({
    text: z.string().default(""),
    motion_graphic_id: z.string(),
    params: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const ShortSegmentSchema = z
  .object({
    segment_id: z.string(),
    start_time: timecode,
    end_time: timecode,
    speaker_focus: z.string().optional(),
    energy: z.enum(["low", "medium", "high", "peak"]).default("medium"),
    transition_in: z.string().default("cut"),
    transition_out: z.string().default("cut"),
    overlays: z.array(ShortOverlaySchema).default([]),
    caption_emphasis: z.array(z.string()).default([]),
  })
  .passthrough();

export const ShortSchema = z
  .object({
    short_id: z.string(),
    title: z.string().optional(),
    target_duration_seconds: z.number().positive().optional(),
    caption_style: z.string().default("bold_social"),
    // v2 hook is an object { text, overlay }; v1 hook is a plain string. Accept
    // both — the parser and timeline builder read whichever shape is present.
    hook: z.union([z.string(), ShortHookSchema]).default(""),
    segments: z.array(ShortSegmentSchema).optional(),
    cta: ShortCTASchema.optional(),
    // v1 (deprecated) clip fields — optional so v2 shorts (which omit them) parse.
    start_time: timecode.optional(),
    end_time: timecode.optional(),
    selection_basis: z.string().optional(),
    confidence,
    framing: FramingSchema.optional(),
    transitions: z.array(NestedTransitionSchema).default([]),
    motion_overlays: z.array(NestedMotionOverlaySchema).default([]),
    topic_banner: z.record(z.unknown()).default({}),
    notes: z.array(z.string()).default([]),
  })
  .passthrough();

// topic_changes is empty in the current fixture; accept any object shape.
const TopicChangeSchema = z.record(z.unknown());

// Images the customGPT says the user must supply before the edit can be built.
// Drives the Asset Onboarding screen (spec addendum v2.1).
export const RequiredAssetSchema = z
  .object({
    asset_id: z.string(), // e.g. "asset_headshot"
    purpose: z.string(), // plain English — shown to the user
    suggested_filename: z.string(), // e.g. "headshot" (no extension)
    used_in: z.array(z.string()).default([]), // overlay/mg IDs that reference it
    optional: z.boolean().default(false),
    // Set when derived from player_image_overlays — groups upload slots by player.
    image_subject: z.string().optional(),
    image_type: z.string().optional(), // portrait | action | celebration | …
  })
  .passthrough();

// A player image the customGPT wants overlaid (e.g. a Son Heung-min action shot).
// Drives per-player upload slots on the Asset Onboarding screen.
export const PlayerImageOverlaySchema = z
  .object({
    image_subject: z.string().optional(), // the player/person; entries without one are skipped
    image_type: z.string().optional(), // role: portrait / action / celebration / …
    overlay_id: z.string().optional(),
    // The customGPT names the on-screen time `appear_time` (e.g. "00:03:43.750");
    // `time` is accepted as an alias. Likewise `appear_duration_seconds`.
    time: timecode.optional(),
    appear_time: timecode.optional(),
    duration_seconds: z.number().optional(),
    appear_duration_seconds: z.number().optional(),
    fade_in_duration_seconds: z.number().optional(),
    fade_out_duration_seconds: z.number().optional(),
    placement: z.string().optional(),
    text: z.string().optional(),
    optional: z.boolean().optional(),
  })
  .passthrough();

const CaptionsSchema = z
  .object({
    style: z.string().optional(),
    requires_transcript: z.boolean().optional(),
    rules: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const LongformSchema = z
  .object({
    cuts: z.array(CutSchema).default([]),
    topic_changes: z.array(TopicChangeSchema).default([]),
    captions: CaptionsSchema.optional(),
    motion_overlays: z.array(MotionOverlaySchema).default([]),
    transitions: z.array(TransitionSchema).default([]),
    chapters: z.array(ChapterSchema).default([]),
  })
  .passthrough();

const MetadataSchema = z
  .object({
    duration_seconds: z.number().positive(),
    duration_timecode: z.string().optional(),
    primary_video: z.string().optional(),
    audio_reference: z.string().optional(),
    video_resolution: z.string().optional(),
    video_frame_rate: z.number().optional(),
  })
  .passthrough();

export const EditListSchema = z
  .object({
    edit_list_version: z.string().optional(),
    project_type: z.string().optional(),
    project_name: z.string(),
    metadata: MetadataSchema,
    longform: LongformSchema,
    shorts: z.array(ShortSchema).default([]),
    required_assets: z.array(RequiredAssetSchema).default([]),
    player_image_overlays: z.array(PlayerImageOverlaySchema).default([]),
  })
  .passthrough();

export type EditList = z.infer<typeof EditListSchema>;
export type RequiredAsset = z.infer<typeof RequiredAssetSchema>;
export type PlayerImageOverlay = z.infer<typeof PlayerImageOverlaySchema>;
export type CutInstruction = z.infer<typeof CutSchema>;
export type ChapterInstruction = z.infer<typeof ChapterSchema>;
export type ShortInstruction = z.infer<typeof ShortSchema>;
export type ShortSegment = z.infer<typeof ShortSegmentSchema>;
export type ShortHook = z.infer<typeof ShortHookSchema>;
export type ShortOverlay = z.infer<typeof ShortOverlaySchema>;
export type ShortCTA = z.infer<typeof ShortCTASchema>;
export type MotionOverlayInstruction = z.infer<typeof MotionOverlaySchema>;
export type TransitionInstruction = z.infer<typeof TransitionSchema>;

/* ── Motion graphic build queue ─────────────────────────────────────────── */
export interface MotionGraphicBuildJob {
  mgId: string;
  templateId: string;
  /** flattened overlay content fields, merged with template defaults. */
  params: Record<string, unknown>;
}

export type ParseEditListResult =
  | {
      ok: true;
      editList: EditList;
      buildQueue: MotionGraphicBuildJob[];
      warnings: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings: string[];
    };

const STRUCTURAL_OVERLAY_KEYS = new Set([
  "overlay_id",
  "time",
  "motion_graphic_id",
  "template_id", // alias of motion_graphic_id (normalised)
  "duration", // alias of duration_seconds (normalised)
  "confidence",
]);

/**
 * Derive the template params from a motion overlay: every field except the
 * structural ones, with `duration_seconds` exposed as `duration`.
 */
export function motionOverlayToParams(overlay: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overlay)) {
    if (STRUCTURAL_OVERLAY_KEYS.has(key)) continue;
    if (key === "duration_seconds") {
      params.duration = value;
      continue;
    }
    params[key] = value;
  }
  return params;
}

/* ── Param validation against the template registry ─────────────────────── */
export function validateTemplateParams(
  def: TemplateDefinition,
  params: Record<string, unknown>,
): { errors: string[]; merged: Record<string, unknown> } {
  const errors: string[] = [];
  const merged: Record<string, unknown> = { ...params };

  for (const [name, schema] of Object.entries(def.params)) {
    const value = params[name];
    const present = value !== undefined && value !== null;

    if (!present) {
      if (schema.required) {
        errors.push(`missing required param "${name}"`);
      } else if (schema.default !== undefined) {
        merged[name] = schema.default; // apply declared default
      }
      continue;
    }

    switch (schema.type) {
      case "string":
      case "color":
        if (typeof value !== "string") errors.push(`param "${name}" must be a string`);
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(`param "${name}" must be a number`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") errors.push(`param "${name}" must be a boolean`);
        break;
      case "enum":
        if (typeof value !== "string" || !(schema.values ?? []).includes(value)) {
          errors.push(`param "${name}" must be one of: ${(schema.values ?? []).join(", ")}`);
        }
        break;
    }
  }

  return { errors, merged };
}

/* ── Normalisation ──────────────────────────────────────────────────────────
 * The customGPT output varies in reasonable ways. Rather than reject those, we
 * fold common variants into the canonical shape BEFORE validation:
 *   1. metadata optional — synthesised with a derived duration when absent
 *   2. cut.remove_duration_seconds derived from start_time/end_time when absent
 *   3. overlay duration accepted as `duration` (timecode or number) → duration_seconds
 *   4. overlay template accepted as `template_id` → motion_graphic_id
 */

/** Coerce a duration value (number, numeric string, or timecode) to seconds. */
function toSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (isValidTimecode(t)) return parseTimecode(t);
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeOverlay(overlay: Record<string, unknown>): void {
  // 4) template_id → motion_graphic_id
  if (overlay.motion_graphic_id == null && typeof overlay.template_id === "string") {
    overlay.motion_graphic_id = overlay.template_id;
  }
  // 3) duration (timecode/number) → duration_seconds
  if (overlay.duration_seconds == null && overlay.duration != null) {
    const seconds = toSeconds(overlay.duration);
    if (seconds != null) overlay.duration_seconds = seconds;
  }
}

/** Largest end time (seconds) across the edit list, for a duration fallback. */
function deriveDurationSeconds(root: Record<string, any>): number {
  let max = 0;
  const note = (seconds: number | undefined) => {
    if (seconds != null && seconds > max) max = seconds;
  };
  const lf = root.longform;
  if (lf && typeof lf === "object") {
    for (const c of lf.cuts ?? []) note(toSeconds(c?.end_time));
    for (const ch of lf.chapters ?? []) note(toSeconds(ch?.end_time ?? ch?.start_time));
    for (const tr of lf.transitions ?? []) note(toSeconds(tr?.time));
    for (const ov of lf.motion_overlays ?? []) {
      const start = toSeconds(ov?.time);
      const dur = toSeconds(ov?.duration_seconds ?? ov?.duration) ?? 0;
      if (start != null) note(start + dur);
    }
  }
  for (const s of root.shorts ?? []) note(toSeconds(s?.end_time));
  return max > 0 ? Number(max.toFixed(3)) : 60; // 60s fallback if nothing datable
}

/**
 * Fold reasonable customGPT output variants into the canonical schema shape.
 * Returns the input untouched when it isn't an object (so validation reports a
 * clean structural error).
 */
export function normalizeEditList(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const root = structuredClone(input) as Record<string, any>;

  const lf = root.longform && typeof root.longform === "object" ? root.longform : undefined;

  // 2) cuts: fill remove_duration_seconds from start/end
  if (lf && Array.isArray(lf.cuts)) {
    for (const cut of lf.cuts) {
      if (cut && typeof cut === "object" && cut.remove_duration_seconds == null) {
        const start = toSeconds(cut.start_time);
        const end = toSeconds(cut.end_time);
        if (start != null && end != null) {
          cut.remove_duration_seconds = Math.max(0, Number((end - start).toFixed(3)));
        }
      }
    }
  }

  // 3 + 4) motion overlays (long-form and nested in shorts)
  if (lf && Array.isArray(lf.motion_overlays)) {
    for (const ov of lf.motion_overlays) {
      if (ov && typeof ov === "object") normalizeOverlay(ov);
    }
  }
  if (Array.isArray(root.shorts)) {
    for (const short of root.shorts) {
      if (short && Array.isArray(short.motion_overlays)) {
        for (const ov of short.motion_overlays) if (ov && typeof ov === "object") normalizeOverlay(ov);
      }
    }
  }

  // 1) metadata optional / duration derived when absent
  const metadata =
    root.metadata && typeof root.metadata === "object" ? root.metadata : (root.metadata = {});
  if (typeof metadata.duration_seconds !== "number" || !Number.isFinite(metadata.duration_seconds)) {
    metadata.duration_seconds = deriveDurationSeconds(root);
  }

  return root;
}

/* ── Shorts Schema v2 validation ──────────────────────────────────────────── */
/** Maximum assembled short duration (seconds). Over this is a hard rejection. */
export const MAX_SHORT_SECONDS = 45;
/** Below this segment count the parser warns (but accepts) — a clip, not a short. */
export const MIN_SHORT_SEGMENTS = 4;

/** Seconds the hook contributes to a short's assembled length (its overlay's
 *  duration when present; 0 if the short has no hook overlay). */
function shortHookDuration(short: ShortInstruction): number {
  const hook = short.hook;
  if (hook && typeof hook === "object" && hook.overlay && typeof hook.overlay.duration_seconds === "number") {
    return hook.overlay.duration_seconds;
  }
  return 0;
}

/**
 * Business validation for one short (Shorts Schema v2). Errors are hard
 * rejections (fail the import); warnings are advisory (import proceeds):
 *  - v1 clip shape (start_time/end_time, no segments) → WARNING (deprecated)
 *  - neither segments nor a clip range → ERROR
 *  - assembled duration (Σ segment durations + hook) over 45s → ERROR
 *  - fewer than 4 segments → WARNING
 *  - an overlay whose appear_at + duration exceeds its segment → ERROR
 *  - any overlay / hook / cta motion_graphic_id not in the registry → ERROR
 */
export function validateShort(
  short: ShortInstruction,
  registry: TemplateRegistry,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const id = short.short_id;
  const segments = Array.isArray(short.segments) ? short.segments : [];
  const hasSegments = segments.length > 0;
  const hasClip = typeof short.start_time === "string" && typeof short.end_time === "string";

  if (!hasSegments) {
    if (hasClip) {
      warnings.push(
        `${id}: uses the deprecated v1 clip schema (start_time/end_time). Re-generate with Edit Director v2 to use segments[].`,
      );
    } else {
      errors.push(`${id}: a short must define segments[] (Shorts Schema v2).`);
    }
    return { errors, warnings };
  }

  if (segments.length < MIN_SHORT_SEGMENTS) {
    warnings.push(
      `${id}: only ${segments.length} segment${segments.length === 1 ? "" : "s"} — minimum ${MIN_SHORT_SEGMENTS} recommended for short-form pacing.`,
    );
  }

  let total = shortHookDuration(short);
  for (const seg of segments) {
    const segDur = Math.max(0, parseTimecode(seg.end_time) - parseTimecode(seg.start_time));
    total += segDur;
    for (const ov of seg.overlays ?? []) {
      const end = (ov.appear_at_seconds ?? 0) + ov.duration_seconds;
      if (end > segDur + 1e-6) {
        errors.push(
          `${id} / ${seg.segment_id}: overlay "${ov.motion_graphic_id}" ends at ${end.toFixed(1)}s but the segment is only ${segDur.toFixed(1)}s long.`,
        );
      }
      if (!registry[ov.motion_graphic_id]) {
        errors.push(
          `${id} / ${seg.segment_id}: unknown motion graphic "${ov.motion_graphic_id}" — not in template-registry.json.`,
        );
      }
    }
  }

  if (total > MAX_SHORT_SECONDS + 1e-6) {
    errors.push(
      `${id}: assembled duration ${total.toFixed(1)}s exceeds the ${MAX_SHORT_SECONDS}s maximum — remove the weakest segment.`,
    );
  }

  const hook = short.hook;
  if (hook && typeof hook === "object" && hook.overlay && !registry[hook.overlay.motion_graphic_id]) {
    errors.push(`${id} / hook: unknown motion graphic "${hook.overlay.motion_graphic_id}".`);
  }
  if (short.cta && !registry[short.cta.motion_graphic_id]) {
    errors.push(`${id} / cta: unknown motion graphic "${short.cta.motion_graphic_id}".`);
  }

  return { errors, warnings };
}

/**
 * Parse and validate a customGPT edit list. Input is first normalised
 * (see normalizeEditList) so reasonable output variations are accepted.
 *
 * @param input    Parsed JSON (object). Pass the result of JSON.parse.
 * @param registry Template registry used to validate motion graphics.
 */
export function parseEditList(input: unknown, registry: TemplateRegistry): ParseEditListResult {
  const parsed = EditListSchema.safeParse(normalizeEditList(input));
  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { ok: false, errors, warnings: [] };
  }

  const editList = parsed.data;
  const warnings: string[] = [];
  const buildQueue: MotionGraphicBuildJob[] = [];
  const validOverlays: typeof editList.longform.motion_overlays = [];

  // Long-form motion graphics are built before the timeline opens (Step 3 of
  // the UX). A bad motion graphic never fails the whole import: unknown
  // templates and invalid params are SKIPPED with a warning (partial import),
  // and the offending overlay is dropped from the timeline + build queue.
  for (const overlay of editList.longform.motion_overlays) {
    const def = registry[overlay.motion_graphic_id];
    if (!def) {
      warnings.push(
        `Skipped "${overlay.overlay_id}": unknown motion graphic template "${overlay.motion_graphic_id}".`,
      );
      continue;
    }
    const params = motionOverlayToParams(overlay as Record<string, unknown>);
    const { errors: paramErrors, merged } = validateTemplateParams(def, params);
    if (paramErrors.length > 0) {
      warnings.push(
        `Skipped "${overlay.overlay_id}" (${overlay.motion_graphic_id}): ${paramErrors.join("; ")}.`,
      );
      continue;
    }
    validOverlays.push(overlay);
    buildQueue.push({
      mgId: overlay.overlay_id,
      templateId: overlay.motion_graphic_id,
      params: merged,
    });
  }

  // Shorts Schema v2 validation. v1 clip shorts are accepted with a deprecation
  // warning; v2 violations (over 45s, overlay overruns, unknown motion graphic)
  // are hard errors that fail the import (per docs/CADS_Shorts_Schema_v2.md).
  const shortErrors: string[] = [];
  for (const short of editList.shorts) {
    const { errors: sErr, warnings: sWarn } = validateShort(short, registry);
    shortErrors.push(...sErr);
    warnings.push(...sWarn);
  }
  if (shortErrors.length > 0) {
    return { ok: false, errors: shortErrors, warnings };
  }

  // Derive per-player upload slots from player_image_overlays (top-level, and
  // defensively from longform) and merge into required_assets so the onboarding
  // screen offers an upload for each player image.
  const playerOverlays = [
    ...editList.player_image_overlays,
    ...((editList.longform as { player_image_overlays?: PlayerImageOverlay[] })
      .player_image_overlays ?? []),
  ];
  const required_assets = mergeRequiredAssets(
    editList.required_assets,
    requiredAssetsFromPlayerOverlays(playerOverlays),
  );

  // Return an edit list whose motion graphics are all buildable (skipped ones
  // removed) so the timeline matches the build queue, with player upload slots
  // folded into required_assets.
  const cleanedEditList: EditList = {
    ...editList,
    longform: { ...editList.longform, motion_overlays: validOverlays },
    required_assets,
  };
  return { ok: true, editList: cleanedEditList, buildQueue, warnings };
}
