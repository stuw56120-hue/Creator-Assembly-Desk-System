/*
 * Pure / testable builder for the ASS (Advanced SubStation Alpha) subtitle
 * file used by the karaoke_highlight caption style. libass (FFmpeg's
 * `subtitles=` filter) handles ASS natively and honours its `{\k<cs>}` tag,
 * which is what gives us the per-word colour transition.
 *
 * Word-level timestamps are not produced by Whisper-small in this pipeline
 * (see PreviewOverlays.tsx — "No word-level timing from the transcript yet"),
 * so we **approximate** by splitting each caption's duration evenly across its
 * word count. That matches the preview-side behaviour exactly so what the user
 * scrubs over matches what FFmpeg burns in.
 *
 * Visual style mirrors the preview's karaoke band:
 *   PrimaryColour   = gold #ffd84a   (the "sung" colour — what \k transitions INTO)
 *   SecondaryColour = white #ffffff  (the upcoming colour — what \k transitions FROM)
 *   BackColour      = ~62% opaque black (the dark band)
 *   OutlineColour   = 50% transparent black
 *   BorderStyle 3   = opaque box background (the dark band rendering)
 *   Alignment 2     = bottom-centre
 *
 * Inputs are captions ALREADY in OUTPUT time — the handler maps source → output
 * before calling, identical to the SRT path.
 */

export interface AssCaption {
  outStart: number;
  duration: number;
  text: string;
}

/** Hint for libass scaling — passes through PlayResX/PlayResY in the header. */
export interface AssFrame {
  width: number;
  height: number;
}

const DEFAULT_FRAME: AssFrame = { width: 1920, height: 1080 };

/**
 * Soft wrap target (visible chars per line). Mirrors the SRT writer's
 * CAPTION_LINE_MAX_CHARS so karaoke captions break at the same boundaries.
 */
const KARAOKE_LINE_MAX_CHARS = 42;

/** Strip HTML / SSA inline tags. Same sanitisation as the SRT writer. */
function stripCaptionMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "");
}

/**
 * Escape literal text that's about to land inside an ASS Dialogue line.
 * ASS treats `{` and `}` as override-block delimiters and `\` as the override
 * escape; everything else (apostrophes, commas, quotes) passes through.
 */
export function escapeAssText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

/** Format seconds as `H:MM:SS.cs` (ASS subtitle time). */
export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return (
    `${h}:` +
    `${String(m).padStart(2, "0")}:` +
    `${String(s).padStart(2, "0")}.` +
    `${String(c).padStart(2, "0")}`
  );
}

/**
 * Render a karaoke dialogue body: per-word `{\k<cs>}word` separated by spaces,
 * with `\N` hard breaks inserted between words when the visible line length
 * would otherwise exceed the soft wrap limit. The \k values sum exactly to
 * `totalCs` so the karaoke sweep finishes when the caption ends.
 */
export function buildKaraokeDialogueBody(
  words: string[],
  totalCs: number,
  maxCharsPerLine = KARAOKE_LINE_MAX_CHARS,
): string {
  if (words.length === 0) return "";
  // Floor the per-word centiseconds and dribble the leftover into the first
  // `remainder` words so Σ\k == totalCs (down to the centisecond).
  const safeTotal = Math.max(0, Math.floor(totalCs));
  const perWord = Math.max(0, Math.floor(safeTotal / words.length));
  const remainder = safeTotal - perWord * words.length;
  // Single-word case: hold for the whole duration. \k0 would advance instantly.
  if (words.length === 1) {
    return `{\\k${safeTotal}}${escapeAssText(words[0])}`;
  }
  const out: string[] = [];
  let lineLen = 0;
  for (let i = 0; i < words.length; i++) {
    const w = escapeAssText(words[i]);
    const extra = i > 0 ? 1 : 0; // one space when not the first word on this line
    if (lineLen > 0 && lineLen + extra + w.length > maxCharsPerLine) {
      out.push("\\N");
      lineLen = 0;
    } else if (i > 0) {
      out.push(" ");
      lineLen += 1;
    }
    const k = perWord + (i < remainder ? 1 : 0);
    out.push(`{\\k${k}}${w}`);
    lineLen += w.length;
  }
  return out.join("");
}

/**
 * Caption font size (PlayRes points). Sized to ~4.5% of frame height for visual
 * parity with the preview, but CAPPED by width (~7.5%) so a narrow 9:16 portrait
 * frame doesn't get an oversized font that overflows the 1080px width.
 */
export function karaokeFontSize(frame: AssFrame): number {
  return Math.max(18, Math.min(Math.round(frame.height * 0.045), Math.round(frame.width * 0.075)));
}

/** Horizontal safe-area margin (PlayRes px) — 6% of width, floored at 40. */
function karaokeMarginX(frame: AssFrame): number {
  return Math.max(40, Math.round(frame.width * 0.06));
}

/**
 * Max visible characters per caption line for this frame. libass uses
 * WrapStyle 2 (no auto-wrap; only our `\N` breaks), so this is what keeps a
 * caption inside the frame. Derived from the usable width (frame width minus
 * both safe-area margins) divided by an Arial average glyph width (~0.5em), then
 * capped at KARAOKE_LINE_MAX_CHARS for readability. A 1080-wide portrait frame
 * lands around ~22 chars; a 1920-wide landscape frame stays at the 42 cap.
 */
export function karaokeWrapChars(frame: AssFrame): number {
  const usable = frame.width - 2 * karaokeMarginX(frame);
  const avgGlyph = karaokeFontSize(frame) * 0.5;
  const physicalMax = Math.floor(usable / avgGlyph);
  return Math.max(8, Math.min(KARAOKE_LINE_MAX_CHARS, physicalMax));
}

/** Header + Karaoke style. PlayRes drives libass font scaling. */
function assHeader(frame: AssFrame): string {
  const { width, height } = frame;
  const fontSize = karaokeFontSize(frame);
  // Safe-area padding so text never reaches the frame edges. Horizontal scales
  // with width (portrait gets a proportionally smaller usable band); vertical
  // keeps the band off the very bottom.
  const marginX = karaokeMarginX(frame);
  const marginV = Math.max(40, Math.round(height * 0.074));
  return (
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `WrapStyle: 2\n` +
    `ScaledBorderAndShadow: yes\n` +
    `PlayResX: ${width}\n` +
    `PlayResY: ${height}\n` +
    `\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    // PrimaryColour &H004AD8FF = gold #ffd84a (BGR 4AD8FF, alpha 00 opaque)
    // SecondaryColour &H00FFFFFF = white
    // OutlineColour &H80000000 = 50% transparent black
    // BackColour &H61000000 = ~62% opaque black (alpha 0x61 → 38% transparent)
    // BorderStyle 3 = opaque box (the dark band the preview shows)
    `Style: Karaoke,Arial,${fontSize},&H004AD8FF,&H00FFFFFF,&H80000000,&H61000000,1,0,0,0,100,100,0,0,3,2,0,2,${marginX},${marginX},${marginV},1\n` +
    `\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  );
}

/**
 * Build a complete ASS file's contents from captions ALREADY in output time.
 *
 * Each caption:
 *   • is stripped of HTML/SSA markup (same as the SRT writer)
 *   • is dropped when empty after sanitisation
 *   • becomes one Dialogue line whose Text is `{\kXX}word ` repeated, with
 *     `\N` for wrapped lines
 *   • single-word captions get one `{\k<full>}` instead of multiple zero-cs
 *     advances (avoids an instantaneous sweep)
 *
 * Empty input → empty string (the handler then skips file creation entirely).
 */
export function buildAssContent(
  captions: AssCaption[],
  frame: AssFrame = DEFAULT_FRAME,
): string {
  if (captions.length === 0) return "";
  // Wrap to the frame width so portrait/9:16 captions stay inside 1080px.
  const maxCharsPerLine = karaokeWrapChars(frame);
  const lines: string[] = [];
  for (const c of captions) {
    const sanitised = stripCaptionMarkup(c.text)
      .replace(/\r\n/g, "\n")
      .replace(/[\x00-\x09\x0B-\x1F]/g, "")
      .trim();
    if (!sanitised) continue;
    const words = sanitised.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const duration = Math.max(0, c.duration);
    const start = assTime(c.outStart);
    const end = assTime(c.outStart + duration);
    const totalCs = Math.round(duration * 100);
    const body = buildKaraokeDialogueBody(words, totalCs, maxCharsPerLine);
    lines.push(`Dialogue: 0,${start},${end},Karaoke,,0,0,0,,${body}`);
  }
  if (lines.length === 0) return "";
  return assHeader(frame) + lines.join("\n") + "\n";
}

/**
 * Project-wide partitioning of captions into ASS (karaoke) vs SRT buckets.
 * Today the project carries one captionStyle for all captions — so every
 * caption lands in one bucket — but the partition is shaped to support a
 * future per-caption style override without changing the call sites.
 */
export function partitionCaptionsByStyle<T>(
  captions: T[],
  projectStyle: string | undefined,
): { ass: T[]; srt: T[] } {
  if (projectStyle === "karaoke_highlight") return { ass: [...captions], srt: [] };
  return { ass: [], srt: [...captions] };
}
