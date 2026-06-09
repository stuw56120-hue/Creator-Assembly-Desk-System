/*
 * Portrait-safe caption system for Shorts Schema v2 (SS-3).
 *
 * The longform ASS path (assBuilder.ts) is tuned for landscape and a single
 * source-time caption track. Shorts assemble non-contiguous segments, so their
 * captions need: (1) word-level timings pulled from the source VTT, (2) per
 * segment extraction + RE-OFFSET to the assembled-timeline position, and (3) a
 * portrait style (920px-safe wrap, word-by-word reveal, emphasis colour).
 *
 * This module is pure (no Node/FFmpeg) — the handler writes the returned ASS
 * string to a temp file and burns it in with libass. Spec:
 * docs/CADS_Shorts_Schema_v2.md.
 */

import { assTime, escapeAssText } from "./assBuilder";

/* ── VTT → word-level timings ─────────────────────────────────────────────── */

export interface VttWord {
  text: string;
  start: number; // SOURCE seconds
  end: number; // SOURCE seconds
}

const VTT_TS =
  /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})/;

function vttTimeToSeconds(t: string): number {
  const p = t.split(":");
  const s = p.length === 3 ? Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]) : Number(p[0]) * 60 + Number(p[1]);
  return Number(s.toFixed(3));
}

/**
 * Parse WebVTT into a word-level timing map. The Zoom VTT carries CUE-level
 * timings only, so each cue's duration is split evenly across its words (the
 * same approximation the longform karaoke path uses). A leading speaker label
 * ("Stuart:") and inline <tags> are stripped.
 */
export function parseVttWords(vtt: string): VttWord[] {
  const words: VttWord[] = [];
  const lines = vtt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = VTT_TS.exec(lines[i]);
    if (!m) continue;
    const start = vttTimeToSeconds(m[1]);
    const end = vttTimeToSeconds(m[2]);
    let text = "";
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ""; j++) {
      text += (text ? " " : "") + lines[j].trim();
    }
    text = text
      .replace(/<[^>]*>/g, "") // inline VTT tags
      .replace(/^[A-Za-z][\w .'-]*:\s*/, "") // leading "Speaker:" label
      .trim();
    const cueWords = text.split(/\s+/).filter(Boolean);
    if (cueWords.length === 0 || end <= start) continue;
    const per = (end - start) / cueWords.length;
    cueWords.forEach((w, k) => {
      words.push({
        text: w,
        start: Number((start + k * per).toFixed(3)),
        end: Number((start + (k + 1) * per).toFixed(3)),
      });
    });
  }
  return words;
}

/* ── Caption styles ───────────────────────────────────────────────────────── */

// ASS colours are &HAABBGGRR (alpha, blue, green, red). Opaque unless noted.
const COL_WHITE = "&H00FFFFFF";
const COL_YELLOW = "&H0000D7FF"; // #FFD700
const COL_ACCENT = "&H00FFC200"; // #00c2ff
const COL_BLACK = "&H00000000";

interface ShortsCaptionStyleDef {
  font: string;
  size: number;
  primary: string; // word colour
  emphasis: string; // caption_emphasis word colour
  alignment: number; // ASS numpad alignment (2 = bottom-centre, 5 = middle-centre)
  /** MarginV = round(frameH * marginVFrac) for bottom-aligned styles; 0 for centre. */
  marginVFrac: number;
  maxWidthPx: number;
  maxLines: number;
  /** Hard cap on words per line, in addition to the width-based wrap (SS-6). */
  maxWordsPerLine?: number;
  borderStyle: number; // 1 = outline+shadow, 3 = opaque box (pill)
  outline: number;
  shadow: number;
}

/**
 * The three v2 caption styles. shorts_bold is the default and the fully-spec'd
 * one. Positions: 65% down → 35% margin from the bottom; lower-third 85% → 15%.
 */
export const SHORTS_CAPTION_STYLES: Record<string, ShortsCaptionStyleDef> = {
  shorts_bold: {
    font: "Arial",
    size: 64,
    primary: COL_WHITE,
    emphasis: COL_YELLOW,
    alignment: 2,
    marginVFrac: 0.35,
    maxWidthPx: 920,
    maxLines: 2,
    maxWordsPerLine: 3, // SS-6: shorts_bold lines hold at most 3 words
    borderStyle: 1,
    outline: 3,
    shadow: 2,
  },
  shorts_minimal: {
    font: "Arial",
    size: 48,
    primary: COL_WHITE,
    emphasis: COL_WHITE, // emphasis is bold weight, not a colour change
    alignment: 2,
    marginVFrac: 0.15,
    maxWidthPx: 920,
    maxLines: 2,
    borderStyle: 3, // pill background
    outline: 0,
    shadow: 0,
  },
  shorts_kinetic: {
    font: "Arial",
    size: 72,
    primary: COL_WHITE,
    emphasis: COL_ACCENT,
    alignment: 5,
    marginVFrac: 0,
    maxWidthPx: 900,
    maxLines: 1,
    borderStyle: 1,
    outline: 3,
    shadow: 2,
  },
};

function styleDef(name: string): ShortsCaptionStyleDef {
  return SHORTS_CAPTION_STYLES[name] ?? SHORTS_CAPTION_STYLES.shorts_bold;
}

/**
 * Max characters per line for a style at a frame width. Lines wrap (via \N) at
 * this boundary so they never exceed the style's safe-area max width. Arial
 * average glyph ≈ 0.5em → maxWidthPx / (0.5 · fontSize).
 */
export function shortsCaptionWrapChars(styleName: string): number {
  const s = styleDef(styleName);
  return Math.max(6, Math.floor(s.maxWidthPx / (s.size * 0.5)));
}

/* ── Caption assembly ─────────────────────────────────────────────────────── */

export interface ShortsCaptionSegment {
  inSeconds: number; // source start
  outSeconds: number; // source end
  emphasis: string[]; // caption_emphasis words / phrases
}

export interface ShortsCaptionsPlan {
  segments: ShortsCaptionSegment[]; // assembled order
  words: VttWord[]; // source-time word map (parseVttWords output)
  captionStyle: string;
  frameWidth?: number;
  frameHeight?: number;
}

interface PlacedWord {
  text: string;
  outStart: number; // assembled-timeline seconds
  outEnd: number;
  emphasised: boolean;
}

/** Normalise a token for emphasis matching: lowercase, strip surrounding punctuation. */
function norm(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/** Words from every emphasis phrase, flattened into a set for per-word matching. */
function emphasisWordSet(emphasis: string[]): Set<string> {
  const set = new Set<string>();
  for (const phrase of emphasis) for (const w of phrase.split(/\s+/)) if (w) set.add(norm(w));
  return set;
}

/**
 * Extract the words that fall within a segment's SOURCE range and re-offset them
 * to the segment's position in the ASSEMBLED timeline. A word that straddles the
 * boundary is kept if its midpoint is inside the range.
 */
export function placeSegmentWords(
  words: VttWord[],
  segInSeconds: number,
  segOutSeconds: number,
  segmentOffset: number,
  emphasis: Set<string>,
): PlacedWord[] {
  const placed: PlacedWord[] = [];
  const segDur = Math.max(0, segOutSeconds - segInSeconds);
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid < segInSeconds || mid >= segOutSeconds) continue;
    const outStart = Number((segmentOffset + Math.max(0, w.start - segInSeconds)).toFixed(3));
    const outEnd = Number((segmentOffset + Math.min(segDur, w.end - segInSeconds)).toFixed(3));
    placed.push({ text: w.text, outStart, outEnd, emphasised: emphasis.has(norm(w.text)) });
  }
  return placed;
}

/**
 * Greedily group placed words into chunks that fit within maxLines lines, where
 * a line breaks at maxChars (width) OR maxWords (a hard per-line word cap, e.g.
 * shorts_bold's 3). Must mirror chunkBody's break logic so a chunk really spans
 * ≤ maxLines lines.
 */
function chunkWords(
  words: PlacedWord[],
  maxChars: number,
  maxLines: number,
  maxWords?: number,
): PlacedWord[][] {
  const chunks: PlacedWord[][] = [];
  let cur: PlacedWord[] = [];
  let lines = 1;
  let lineLen = 0;
  let lineWords = 0;
  for (const w of words) {
    const wlen = w.text.length;
    const extra = lineLen > 0 ? 1 : 0;
    const overChars = lineLen > 0 && lineLen + extra + wlen > maxChars;
    const overWords = maxWords != null && lineWords >= maxWords;
    if (overChars || overWords) {
      // This word starts a new line.
      if (lines + 1 > maxLines) {
        chunks.push(cur);
        cur = [];
        lines = 1;
        lineLen = 0;
        lineWords = 0;
      } else {
        lines += 1;
        lineLen = 0;
        lineWords = 0;
      }
    }
    cur.push(w);
    lineLen += (lineLen > 0 ? 1 : 0) + wlen;
    lineWords += 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const CHUNK_HOLD_SECONDS = 0.3; // the completed line lingers briefly after the last word

/**
 * Render one chunk to an ASS Dialogue body with word-by-word reveal: each word
 * carries a `{\k}` whose value is the gap until the NEXT word reveals, so words
 * appear at their real assembled times. Emphasis words override the colour. \N
 * wraps lines at maxChars.
 */
function chunkBody(chunk: PlacedWord[], maxChars: number, style: ShortsCaptionStyleDef): string {
  const endHold = chunk[chunk.length - 1].outEnd + CHUNK_HOLD_SECONDS;
  const out: string[] = [];
  let lineLen = 0;
  let lineWords = 0;
  for (let i = 0; i < chunk.length; i++) {
    const w = chunk[i];
    const wlen = w.text.length;
    const extra = lineLen > 0 ? 1 : 0;
    const overChars = lineLen > 0 && lineLen + extra + wlen > maxChars;
    const overWords = style.maxWordsPerLine != null && lineWords >= style.maxWordsPerLine;
    if (overChars || overWords) {
      out.push("\\N");
      lineLen = 0;
      lineWords = 0;
    } else if (i > 0) {
      out.push(" ");
      lineLen += 1;
    }
    const nextReveal = i + 1 < chunk.length ? chunk[i + 1].outStart : endHold;
    const k = Math.max(0, Math.round((nextReveal - w.outStart) * 100));
    const txt = escapeAssText(w.text);
    const coloured =
      w.emphasised && style.emphasis !== style.primary
        ? `{\\1c${style.emphasis}}${txt}{\\1c${style.primary}}`
        : txt;
    out.push(`{\\k${k}}${coloured}`);
    lineLen += wlen;
    lineWords += 1;
  }
  return out.join("");
}

/** Header + the single Shorts caption style. */
function header(style: ShortsCaptionStyleDef, frameW: number, frameH: number): string {
  const marginV = style.alignment === 5 ? 0 : Math.round(frameH * style.marginVFrac);
  const marginX = Math.max(0, Math.round((frameW - style.maxWidthPx) / 2)); // safe-area padding
  // SecondaryColour fully transparent → unsung words are invisible, so the line
  // reveals word by word (the "each word appears as it is spoken" effect).
  const secondary = "&HFFFFFFFF";
  const back = style.borderStyle === 3 ? "&H80000000" : COL_BLACK; // pill vs none
  return (
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `WrapStyle: 2\n` +
    `ScaledBorderAndShadow: yes\n` +
    `PlayResX: ${frameW}\n` +
    `PlayResY: ${frameH}\n` +
    `\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Shorts,${style.font},${style.size},${style.primary},${secondary},${COL_BLACK},${back},1,0,0,0,100,100,0,0,${style.borderStyle},${style.outline},${style.shadow},${style.alignment},${marginX},${marginX},${marginV},1\n` +
    `\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  );
}

/**
 * Build the ASS caption file for an assembled v2 short. Words are pulled per
 * segment from the source VTT, re-offset to the assembled timeline, grouped into
 * portrait-safe ≤maxLines chunks, and revealed word-by-word with emphasis
 * highlights. Returns "" when there are no captionable words (handler then skips
 * writing a file). Captions are burned in by the render handler (SS-2 output →
 * subtitles=<this ass>).
 */
export function buildShortsCaptions(plan: ShortsCaptionsPlan): string {
  const style = styleDef(plan.captionStyle);
  const frameW = plan.frameWidth ?? 1080;
  const frameH = plan.frameHeight ?? 1920;
  const maxChars = shortsCaptionWrapChars(plan.captionStyle);

  const dialogues: string[] = [];
  let offset = 0;
  for (const seg of plan.segments) {
    const segDur = Math.max(0, seg.outSeconds - seg.inSeconds);
    const placed = placeSegmentWords(plan.words, seg.inSeconds, seg.outSeconds, offset, emphasisWordSet(seg.emphasis));
    offset += segDur;
    if (placed.length === 0) continue;
    for (const chunk of chunkWords(placed, maxChars, style.maxLines, style.maxWordsPerLine)) {
      const start = assTime(chunk[0].outStart);
      const end = assTime(chunk[chunk.length - 1].outEnd + CHUNK_HOLD_SECONDS);
      dialogues.push(`Dialogue: 0,${start},${end},Shorts,,0,0,0,,${chunkBody(chunk, maxChars, style)}`);
    }
  }

  if (dialogues.length === 0) return "";
  return header(style, frameW, frameH) + dialogues.join("\n") + "\n";
}
