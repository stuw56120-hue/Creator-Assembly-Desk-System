/*
 * C.A.D.S. render plan builder (pure).
 *
 * Builds the FFmpeg argument vectors for the final long-form render and for the
 * vertical 9:16 shorts. No Node/Electron deps — the ffmpeg handler spawns the
 * binary with what these functions produce, and the logic is unit-testable.
 *
 * Spec constraints honored:
 *  - All timeline coordinates are SOURCE video seconds; OUTPUT timecodes are
 *    computed here, only at render time, via the enabled keep segments.
 *  - Only enabled cuts are applied (the keep segments are the complement of
 *    enabled cuts, computed by timelineBuilder).
 *  - Motion graphics / overlays composite ON TOP — they never cut the video —
 *    and are chained in a single filter_complex.
 */

import type { KeepSegment } from "./types";

/** Re-exported so the Electron handler can type render plans without importing types.ts. */
export type KeepSegmentLike = KeepSegment;

export interface RenderOverlayInput {
  inputPath: string; // absolute path to the WebM (alpha) or image
  sourceStart: number; // SOURCE seconds where the overlay begins
  duration: number;
  placement: string;
  /**
   * Free-position from the editor (drag/resize): normalised CENTRE x/y and
   * width (0–1, relative to the output frame). When all three are present they
   * drive pixel placement + scaling; otherwise we fall back to `placement`.
   */
  x?: number;
  y?: number;
  width?: number;
  /** Motion graphics are full-frame comps — scale to cover the frame. */
  fullFrame?: boolean;
  /** Composite opacity 0–1 (overlayData.opacity). 1 / undefined = fully opaque. */
  opacity?: number;
}

/** A transition cue (e.g. smash_cut, punch_zoom) at a SOURCE time. */
export interface RenderTransitionInput {
  sourceStart: number; // SOURCE seconds where the transition happens
  type: string; // smash_cut | punch_zoom | … (others are left as markers for now)
}

/**
 * A caption event at SOURCE time, as it comes from the renderer. The handler
 * maps it to OUTPUT time (different per render flavour), writes an SRT, and
 * passes the SRT path to the builder via `subtitlesFilePath` — one filter, not
 * 893 chained drawtext nodes that blow past Windows' arg cap and trip on the
 * `enable='between(t,…)'` parser.
 */
export interface RenderCaptionInput {
  sourceStart: number;
  duration: number;
  text: string;
}

/**
 * Effect window lengths (seconds) — long enough to actually SEE.
 * smash_cut ≥ 3 frames @30fps (0.10s); punch_zoom / slide_left ≥ 0.30s.
 */
const SMASH_CUT_FLASH_SECONDS = 0.15;
const PUNCH_ZOOM_SECONDS = 0.35;
const PUNCH_ZOOM_SCALE = 1.22; // how far the quick zoom punches in
const SLIDE_LEFT_SECONDS = 0.35;

/**
 * Canonical transition type. The director's casing/spacing varies
 * ("Smash Cut", "smash-cut", "PUNCH_ZOOM") — fold them all to snake_case so the
 * effect actually triggers (exact-match was the reason only cut_hard "worked").
 */
function normalizeTransitionType(type: string): string {
  return type.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Encode settings (from config/ffmpeg_presets.json). Optional — omitting it
 * reproduces the original baked-in encode flags exactly. */
export interface RenderPreset {
  videoCodec: string;
  pixelFormat?: string;
  audioCodec: string;
  preset?: string;
  crf?: number;
}

export interface LongformRenderPlan {
  sourcePath: string;
  keepSegments: KeepSegment[];
  overlays: RenderOverlayInput[];
  transitions?: RenderTransitionInput[];
  outputPath: string;
  ffmpegBin?: string;
  preset?: RenderPreset;
  /** Output frame size (source dims for long-form). Defaults to 1920×1080. */
  frameWidth?: number;
  frameHeight?: number;
  /** Path to an SRT (already built by the handler in OUTPUT time). */
  subtitlesFilePath?: string;
  /**
   * Path to an ASS file carrying karaoke_highlight captions (already in OUTPUT
   * time). libass renders ASS with its native `{\k}` tag support — chained
   * after the SRT filter when both are present. See buildAssContent.
   */
  assFilePath?: string;
  /** Caption appearance preset (see captionForceStyle). */
  captionStyle?: string;
}

export interface ShortRenderPlan {
  sourcePath: string;
  inSeconds: number;
  outSeconds: number;
  overlays: RenderOverlayInput[];
  outputPath: string;
  ffmpegBin?: string;
  preset?: RenderPreset;
  /** Output frame size. Shorts are 1080×1920. */
  frameWidth?: number;
  frameHeight?: number;
  /** Path to an SRT containing this short's captions in SHORT-LOCAL time. */
  subtitlesFilePath?: string;
  /** Path to an ASS file (karaoke_highlight only) in SHORT-LOCAL time. */
  assFilePath?: string;
  captionStyle?: string;
}

/**
 * Trailing FFmpeg encode flags. With no preset this is exactly the original
 * libx264/yuv420p/aac default; a preset adds its codecs, -preset and -crf.
 */
function encodeArgs(preset?: RenderPreset): string[] {
  if (!preset) {
    return ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"];
  }
  const args = ["-c:v", preset.videoCodec, "-pix_fmt", preset.pixelFormat ?? "yuv420p"];
  if (preset.preset) args.push("-preset", preset.preset);
  if (preset.crf != null) args.push("-crf", String(preset.crf));
  args.push("-c:a", preset.audioCodec);
  return args;
}

/**
 * Map a SOURCE time to its OUTPUT time once enabled cuts are removed: the sum of
 * kept duration lying before `sourceTime`. A time inside a removed gap maps to
 * the end of the preceding kept span.
 */
export function sourceToOutputTime(sourceTime: number, keepSegments: KeepSegment[]): number {
  let output = 0;
  for (const seg of keepSegments) {
    if (sourceTime >= seg.end) {
      output += seg.end - seg.start;
    } else if (sourceTime > seg.start) {
      output += sourceTime - seg.start;
      break;
    } else {
      break;
    }
  }
  return Number(output.toFixed(3));
}

/** Total output (post-cut) duration. */
export function outputDuration(keepSegments: KeepSegment[]): number {
  return Number(keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0).toFixed(3));
}

/**
 * FFmpeg overlay x/y expressions for a placement keyword. W/H = main frame,
 * w/h = overlay. A 40px margin matches the spec's example.
 */
export function placementExpr(placement: string): { x: string; y: string } {
  const M = 40; // vertical inset
  const MH_CORNER = 20; // halved horizontal inset for the four corner placements
  // Accept the director's top_/bottom_ names as aliases of upper_/lower_ so the
  // render matches the preview (see PreviewOverlays.normalizePlacement).
  const normalized =
    {
      top_left: "upper_left",
      top_right: "upper_right",
      bottom_left: "lower_left",
      bottom_right: "lower_right",
      top: "top_center",
      bottom: "bottom_center",
    }[placement] ?? placement;
  switch (normalized) {
    case "center":
      return { x: "(W-w)/2", y: "(H-h)/2" };
    case "left_center":
      return { x: `${M}`, y: "(H-h)/2" };
    case "right_center":
      return { x: `W-w-${M}`, y: "(H-h)/2" };
    case "upper_left":
      return { x: `${MH_CORNER}`, y: `${M}` };
    case "upper_right":
      return { x: `W-w-${MH_CORNER}`, y: `${M}` };
    case "lower_left":
      return { x: `${MH_CORNER}`, y: `H-h-${M}` };
    case "lower_right":
      return { x: `W-w-${MH_CORNER}`, y: `H-h-${M}` };
    case "top_center":
      return { x: "(W-w)/2", y: `${M}` };
    case "bottom_center":
      return { x: "(W-w)/2", y: `H-h-${M}` };
    case "full":
      return { x: "0", y: "0" };
    default:
      return { x: "(W-w)/2", y: "(H-h)/2" };
  }
}

/** Build the cut concat segment of a filter_complex; result video=[cv] audio=[ca]. */
function buildCutConcat(keepSegments: KeepSegment[]): string[] {
  if (keepSegments.length === 0) {
    // No cuts to apply — pass the source through unchanged.
    return ["[0:v]setpts=PTS-STARTPTS[cv]", "[0:a]asetpts=PTS-STARTPTS[ca]"];
  }
  const parts: string[] = [];
  const concatLabels: string[] = [];
  keepSegments.forEach((seg, i) => {
    parts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
    concatLabels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${concatLabels.join("")}concat=n=${keepSegments.length}:v=1:a=1[cv][ca]`);
  return parts;
}

interface MappedOverlay {
  outStart: number;
  duration: number;
  placement: string;
  x?: number;
  y?: number;
  width?: number;
  fullFrame?: boolean;
  opacity?: number;
}

/** Round to the nearest even integer (FFmpeg encoders want even dimensions). */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * Chain overlay filters on top of `baseLabel`, each enabled over its OUTPUT-time
 * window. Positioning, in priority order:
 *   1. fullFrame (motion graphics) → scale to the frame, overlay at 0,0.
 *   2. normalised x/y/width (editor drag/resize) → scale the overlay to the
 *      pixel width and centre it on the pixel point (x·W, y·H).
 *   3. otherwise → the placement keyword (unchanged legacy behaviour).
 * Returns filter parts (scale filters first, then the overlay chain) + label.
 */
function buildOverlayChain(
  baseLabel: string,
  overlays: MappedOverlay[],
  frameW: number,
  frameH: number,
): { parts: string[]; finalLabel: string } {
  if (overlays.length === 0) return { parts: [], finalLabel: baseLabel };
  const scaleParts: string[] = [];
  const chainParts: string[] = [];
  let current = baseLabel;
  overlays.forEach((ov, i) => {
    const inputLabel = `[${i + 1}:v]`; // overlay inputs follow the source (input 0)
    const outLabel = i === overlays.length - 1 ? "[outv]" : `[ov${i}]`;
    const end = Number((ov.outStart + ov.duration).toFixed(3));

    let src = inputLabel;
    let x: string;
    let y: string;
    if (ov.fullFrame) {
      const s = `[ovs${i}]`;
      scaleParts.push(`${inputLabel}scale=${frameW}:${frameH}${s}`);
      src = s;
      x = "0";
      y = "0";
    } else if (ov.x != null && ov.y != null && ov.width != null) {
      const wpx = even(ov.width * frameW);
      const cx = Math.round(ov.x * frameW);
      const cy = Math.round(ov.y * frameH);
      const s = `[ovs${i}]`;
      scaleParts.push(`${inputLabel}scale=${wpx}:-2${s}`); // -2 keeps aspect, even height
      src = s;
      x = `${cx}-w/2`; // centre the scaled overlay on (cx,cy)
      y = `${cy}-h/2`;
    } else {
      const p = placementExpr(ov.placement);
      x = p.x;
      y = p.y;
    }

    // Composite opacity: multiply the overlay's alpha by the opacity factor
    // (overlayData.opacity) so a semi-transparent MG/image renders the same way
    // it previews. Skipped at full opacity so opaque overlays are byte-for-byte
    // unchanged. colorchannelmixer aa scales the existing alpha (works for both
    // alpha WebMs and opaque images promoted to rgba).
    const op = typeof ov.opacity === "number" ? ov.opacity : 1;
    if (op < 1) {
      const a = `[ova${i}]`;
      const clamped = Math.max(0, Math.min(1, op)).toFixed(3);
      scaleParts.push(`${src}format=rgba,colorchannelmixer=aa=${clamped}${a}`);
      src = a;
    }

    chainParts.push(
      `${current}${src}overlay=x=${x}:y=${y}:enable='between(t,${ov.outStart},${end})'${outLabel}`,
    );
    current = outLabel;
  });
  return { parts: [...scaleParts, ...chainParts], finalLabel: current };
}

/**
 * Apply transition effects to the (already cut-concatenated) base video, before
 * the overlay chain. Each cue is rendered at its OUTPUT time:
 *  - smash_cut: a brief full-frame white flash (drawbox, timeline-enabled).
 *  - punch_zoom: a quick zoom-in — the frame is scaled up + centre-cropped on a
 *    split branch and overlaid only during the window, so the rest of the clip
 *    is untouched (overlay is timeline-enabled; scale/crop are not).
 * Other transition types (e.g. slide_left) are left as markers for now and do
 * not alter the stream. Returns the filter parts and the resulting video label;
 * with no recognised cues it returns the base label unchanged (so a render with
 * no transitions produces byte-for-byte the same args as before).
 */
function buildTransitionChain(
  baseLabel: string,
  transitions: { outStart: number; type: string }[],
): { parts: string[]; finalLabel: string } {
  const flashes = transitions.filter((t) => normalizeTransitionType(t.type) === "smash_cut");
  const zooms = transitions.filter((t) => normalizeTransitionType(t.type) === "punch_zoom");
  const slides = transitions.filter((t) => normalizeTransitionType(t.type) === "slide_left");
  if (flashes.length === 0 && zooms.length === 0 && slides.length === 0) {
    return { parts: [], finalLabel: baseLabel };
  }

  // 'between(t,a,b)' windows summed — enable is true wherever the sum is > 0.
  const windowsExpr = (cues: { outStart: number }[], dur: number) =>
    cues
      .map((c) => `between(t,${c.outStart},${Number((c.outStart + dur).toFixed(3))})`)
      .join("+");

  const parts: string[] = [];
  let current = baseLabel;

  if (flashes.length > 0) {
    const out = "[txflash]";
    parts.push(
      `${current}drawbox=x=0:y=0:w=iw:h=ih:color=white@0.92:t=fill:` +
        `enable='${windowsExpr(flashes, SMASH_CUT_FLASH_SECONDS)}'${out}`,
    );
    current = out;
  }

  if (zooms.length > 0) {
    parts.push(`${current}split=2[txzbase][txzsrc]`);
    parts.push(
      `[txzsrc]scale=iw*${PUNCH_ZOOM_SCALE}:ih*${PUNCH_ZOOM_SCALE},` +
        `crop=iw/${PUNCH_ZOOM_SCALE}:ih/${PUNCH_ZOOM_SCALE}[txzoomed]`,
    );
    const out = "[txv]";
    parts.push(
      `[txzbase][txzoomed]overlay=x=0:y=0:enable='${windowsExpr(zooms, PUNCH_ZOOM_SECONDS)}'${out}`,
    );
    current = out;
  }

  if (slides.length > 0) {
    // A copy of the frame slides in from the right edge (x: W→0) over the
    // window — a visible "slide left". Off-screen (x=W) when no slide is active,
    // so no enable expression is needed. Windows don't overlap, so a nested-if
    // selects the active slide's x.
    const xExpr = slides.reduceRight(
      (acc, c) =>
        `if(between(t,${c.outStart},${Number((c.outStart + SLIDE_LEFT_SECONDS).toFixed(3))}),` +
        `W-W*(t-${c.outStart})/${SLIDE_LEFT_SECONDS},${acc})`,
      "W",
    );
    parts.push(`${current}split=2[slbase][slsrc]`);
    const out = "[slv]";
    parts.push(`[slbase][slsrc]overlay=x='${xExpr}':y=0${out}`);
    current = out;
  }

  return { parts, finalLabel: current };
}

/**
 * Pick the dominant `caption_style` from a render's caption events. Per spec
 * ties default to clean_podcast. The renderer currently passes a single
 * project-wide style; this helper exists so a future per-caption style can be
 * routed through the same code path without changing the handler.
 */
export function pickDominantCaptionStyle(styles: (string | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const s of styles) {
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (counts.size === 0) return "clean_podcast";
  let winner: string | null = null;
  let topCount = 0;
  for (const [s, c] of counts) {
    if (c > topCount) {
      winner = s;
      topCount = c;
    } else if (c === topCount) {
      winner = null; // tied → fall through to default
    }
  }
  return winner ?? "clean_podcast";
}

/** Per-style ASS force_style string for the subtitles filter. */
export function captionForceStyle(style: string | undefined): string {
  // ASS colours are &HAABBGGRR. &H00FFFFFF = opaque white, &H0000FFFF = yellow
  // (R=255,G=255,B=0 → BGR FF FF 00 with alpha 00). Alignment 2 = bottom-centre.
  // OutlineColour = &H80000000 = 50% transparent black outline.
  const COMMON = "PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,Outline=2,Alignment=2";
  switch (style) {
    case "bold_social":
      return `FontName=Arial,FontSize=24,${COMMON.replace("PrimaryColour=&H00FFFFFF", "PrimaryColour=&H0000FFFF")}`;
    case "quote_emphasis":
      return `FontName=Arial,FontSize=20,Italic=1,${COMMON}`;
    case "clean_podcast":
    default:
      return `FontName=Arial,FontSize=20,${COMMON}`;
  }
}

/** Format seconds as SRT timecode `HH:MM:SS,mmm`. */
function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(milli).padStart(3, "0")
  );
}

/** Soft caption line length — keeps lines from overflowing the lower third. */
const CAPTION_LINE_MAX_CHARS = 42;

/**
 * Strip HTML (`<i>`, `<b>`, etc.) and SSA inline tags (`{\\b1}`, `{\\i1}`, …)
 * that occasionally leak in from Whisper output / customGPT drafts. libass
 * would otherwise interpret them and either crash or paint stray runs.
 */
function stripCaptionMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "");
}

/**
 * Word-aware soft-wrap to ~42 chars/line. A single word longer than the limit
 * gets its own line (we don't hyphenate). Returns a string with `\n` between
 * lines — valid SRT body, kind to the lower-third.
 */
function wrapCaptionText(text: string, maxLen = CAPTION_LINE_MAX_CHARS): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxLen) {
      current += " " + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

/**
 * Build a complete SRT file's contents from captions ALREADY in output time.
 * Pure / testable. Each caption is stripped of HTML/SSA markup, normalised,
 * soft-wrapped at ~42 chars. Captions whose text is empty AFTER sanitisation
 * are dropped, and the surviving SRT entries are sequentially renumbered.
 * Apostrophes and quotes pass through untouched. Empty input → empty string.
 */
export function buildSrtContent(captions: { outStart: number; duration: number; text: string }[]): string {
  if (captions.length === 0) return "";
  const blocks: string[] = [];
  for (const c of captions) {
    const sanitised = stripCaptionMarkup(c.text)
      .replace(/\r\n/g, "\n")
      .replace(/[\x00-\x09\x0B-\x1F]/g, "")
      .trim();
    if (!sanitised) continue;
    const wrapped = wrapCaptionText(sanitised);
    const start = srtTime(c.outStart);
    const end = srtTime(c.outStart + Math.max(0, c.duration));
    blocks.push(`${blocks.length + 1}\n${start} --> ${end}\n${wrapped}\n`);
  }
  return blocks.join("\n");
}

/** Map captions (source time) to LONGFORM output time through the cut concat. */
export function mapCaptionsForLongform(
  captions: { sourceStart: number; duration: number; text: string }[],
  keepSegments: KeepSegment[],
): { outStart: number; duration: number; text: string }[] {
  return captions.map((c) => ({
    outStart: sourceToOutputTime(c.sourceStart, keepSegments),
    duration: c.duration,
    text: c.text,
  }));
}

/**
 * Filter captions to those INTERSECTING [inSeconds, outSeconds] (i.e. a caption
 * that starts BEFORE the short but ends during it still gets included) and
 * offset to SHORT-LOCAL time. Clamps both edges to the short span and drops
 * pathological entries per the spec:
 *   - new_end   <= 0
 *   - new_start >= short_duration
 *   - new_start >= new_end
 */
export function mapCaptionsForShort(
  captions: { sourceStart: number; duration: number; text: string }[],
  inSeconds: number,
  outSeconds: number,
): { outStart: number; duration: number; text: string }[] {
  const span = Math.max(0, outSeconds - inSeconds);
  if (span <= 0) return [];
  const result: { outStart: number; duration: number; text: string }[] = [];
  for (const c of captions) {
    const capDur = Math.max(0, c.duration);
    const capEnd = c.sourceStart + capDur;
    // Reject non-overlapping caps cheaply before doing the maths.
    if (capEnd <= inSeconds || c.sourceStart >= outSeconds) continue;
    const newStart = Number(Math.max(0, c.sourceStart - inSeconds).toFixed(3));
    const newEnd = Number(Math.min(span, capEnd - inSeconds).toFixed(3));
    if (newEnd <= 0 || newStart >= span || newStart >= newEnd) continue;
    result.push({ outStart: newStart, duration: Number((newEnd - newStart).toFixed(3)), text: c.text });
  }
  return result;
}

/**
 * Append one or two `subtitles=` filters to `baseLabel`:
 *   • SRT (if `srtPath`) — non-karaoke styles via libass force_style
 *   • ASS (if `assPath`) — karaoke_highlight via embedded V4+ styles + \k tags
 *
 * Chain order is SRT first, ASS second — both write to z-ordered overlay
 * planes, and the ASS dark band is the one the user expects to see for
 * karaoke captions, so it should win when both happen to overlap (e.g. in a
 * future mixed-style render).
 *
 * libass renders each file in ONE filter — 893 cues cost about the same as
 * one — so two filters max, well under Windows' 32 KB arg cap.
 * Returns the empty chain when both inputs are undefined.
 */
function buildSubtitlesFilter(
  baseLabel: string,
  srtPath: string | undefined,
  style: string | undefined,
  assPath?: string,
): { parts: string[]; finalLabel: string } {
  // Forward-slash path; `:` escaped for the filter-arg parser. Single-quoting
  // the path + force_style keeps the filter-graph parser from treating commas
  // inside force_style as filter separators.
  const escapePath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
  const parts: string[] = [];
  let current = baseLabel;
  if (srtPath) {
    const next = assPath ? "[srtsubs]" : "[subs]";
    parts.push(
      `${current}subtitles=filename='${escapePath(srtPath)}':force_style='${captionForceStyle(style)}'${next}`,
    );
    current = next;
  }
  if (assPath) {
    const next = "[subs]";
    // ASS carries its own [V4+ Styles] block, so no force_style here.
    parts.push(`${current}subtitles=filename='${escapePath(assPath)}'${next}`);
    current = next;
  }
  return { parts, finalLabel: current };
}

/**
 * Input args for one overlay. Motion-graphic WebMs carry their alpha in a
 * SEPARATE VP9 stream that FFmpeg's DEFAULT `vp9` decoder silently ignores — the
 * overlay then composites as an opaque rectangle over the video. Forcing the
 * `libvpx-vp9` decoder before the input exposes the alpha plane to the overlay
 * filter, so transparency is honored. Image overlays need no decoder override.
 */
function overlayInputArgs(inputPath: string): string[] {
  return /\.webm$/i.test(inputPath)
    ? ["-c:v", "libvpx-vp9", "-i", inputPath]
    : ["-i", inputPath];
}

/** Full FFmpeg argv (excluding the binary) for the long-form render. */
export function buildLongformRenderArgs(plan: LongformRenderPlan): string[] {
  const frameW = plan.frameWidth ?? 1920;
  const frameH = plan.frameHeight ?? 1080;
  const args: string[] = ["-i", plan.sourcePath];
  for (const ov of plan.overlays) args.push(...overlayInputArgs(ov.inputPath));

  const concat = buildCutConcat(plan.keepSegments);

  // Transition effects sit between the cut concat and the overlay chain, mapped
  // to OUTPUT time so they land where the kept content actually plays.
  const mappedTransitions = (plan.transitions ?? []).map((tr) => ({
    outStart: sourceToOutputTime(tr.sourceStart, plan.keepSegments),
    type: tr.type,
  }));
  const { parts: transitionParts, finalLabel: videoBase } = buildTransitionChain(
    "[cv]",
    mappedTransitions,
  );

  const mappedOverlays: MappedOverlay[] = plan.overlays.map((ov) => ({
    outStart: sourceToOutputTime(ov.sourceStart, plan.keepSegments),
    duration: ov.duration,
    placement: ov.placement,
    x: ov.x,
    y: ov.y,
    width: ov.width,
    fullFrame: ov.fullFrame,
    opacity: ov.opacity,
  }));
  const { parts: overlayParts, finalLabel: overlayFinal } = buildOverlayChain(videoBase, mappedOverlays, frameW, frameH);

  // Captions burned in via libass — up to two subtitles filters (SRT + ASS)
  // reading files the handler wrote (already in OUTPUT time).
  const { parts: captionParts, finalLabel } = buildSubtitlesFilter(
    overlayFinal,
    plan.subtitlesFilePath,
    plan.captionStyle,
    plan.assFilePath,
  );

  const filterComplex = [...concat, ...transitionParts, ...overlayParts, ...captionParts].join(";");
  args.push("-filter_complex", filterComplex, "-map", finalLabel, "-map", "[ca]");
  args.push(...encodeArgs(plan.preset), "-y", plan.outputPath);
  return args;
}

/** Full FFmpeg argv for a vertical 9:16 short with overlays. */
export function buildShortRenderArgs(plan: ShortRenderPlan): string[] {
  // -ss/-to before -i trims at the input, so overlay/clip time starts at 0.
  const args: string[] = [
    "-ss",
    String(plan.inSeconds),
    "-to",
    String(plan.outSeconds),
    "-i",
    plan.sourcePath,
  ];
  for (const ov of plan.overlays) args.push(...overlayInputArgs(ov.inputPath));

  const frameW = plan.frameWidth ?? 1080;
  const frameH = plan.frameHeight ?? 1920;
  // Centre-crop to 9:16, then scale to 1080×1920.
  const parts = ["[0:v]crop=w=ih*9/16:h=ih,scale=1080:1920,setpts=PTS-STARTPTS[base]"];
  const mappedOverlays: MappedOverlay[] = plan.overlays.map((ov) => ({
    outStart: Number(Math.max(0, ov.sourceStart - plan.inSeconds).toFixed(3)),
    duration: ov.duration,
    placement: ov.placement,
    x: ov.x,
    y: ov.y,
    width: ov.width,
    fullFrame: ov.fullFrame,
    opacity: ov.opacity,
  }));
  const { parts: overlayParts, finalLabel: overlayFinal } = buildOverlayChain("[base]", mappedOverlays, frameW, frameH);

  // Up to two subtitles filters for the short — SRT and/or ASS. Both files are
  // pre-filtered + offset to short-local time (see mapCaptionsForShort and the
  // handler's writeCaptionFiles).
  const { parts: captionParts, finalLabel } = buildSubtitlesFilter(
    overlayFinal,
    plan.subtitlesFilePath,
    plan.captionStyle,
    plan.assFilePath,
  );

  args.push(
    "-filter_complex",
    [...parts, ...overlayParts, ...captionParts].join(";"),
    "-map",
    finalLabel,
    "-map",
    "0:a",
  );
  args.push(...encodeArgs(plan.preset), "-y", plan.outputPath);
  return args;
}

/** Proxy generation: downscale to a fast preview MP4 (preview source, never the 42-min original). */
export function buildProxyRenderArgs(sourcePath: string, outputPath: string): string[] {
  // A lightweight review proxy — only good enough to scrub and review edits, not
  // broadcast quality. Capped to 540p with a low, hard-capped bitrate so the
  // <video> element decodes smoothly without skipping.
  return [
    "-i",
    sourcePath,
    "-vf",
    "scale=-2:540", // 540p max long edge (downscale only; -2 keeps even width)
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "30", // 28+ → leaner files; the cap below is the real ceiling
    "-maxrate",
    "1500k", // hard video bitrate cap ~1.5 Mbps
    "-bufsize",
    "3000k",
    "-pix_fmt",
    "yuv420p", // widest browser decode compatibility
    "-c:a",
    "aac",
    "-b:a",
    "128k", // audio bitrate cap
    // Move the moov atom to the front so the <video> element can start playing
    // before the whole file is read (and seek without a full download).
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];
}
