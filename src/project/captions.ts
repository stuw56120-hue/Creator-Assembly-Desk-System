/*
 * Caption helpers (pure).
 *
 * Captions live on the timeline as `kind: "caption"` events, so edits flow
 * through the normal store/undo/timeline machinery. This module handles the
 * transcript text format and the split/merge/word-count logic, independent of
 * React and the store.
 *
 * Upload transcript format (one segment per line):
 *     [HH:MM:SS] Speaker Name: caption text
 * The speaker prefix is optional ([HH:MM:SS] caption text), and [MM:SS] is also
 * accepted. End times are inferred from the next segment's start.
 */

import { isValidTimecode, parseTimecode } from "./timecode";
import { TRACK, type TimelineEvent } from "./types";

/** A caption with a stable id (as stored on the timeline). */
export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

/** A caption without an id (split/merge results; the store assigns ids). */
export interface CaptionCore {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

/** Captions longer than this (in words) are flagged for the user to tighten. */
export const EXCESS_WORDS = 7;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function isCaptionTooLong(text: string): boolean {
  return countWords(text) > EXCESS_WORDS;
}

const LINE_RE = /^\[\s*([0-9:.]+)\s*\]\s*(.*)$/;
const SPEAKER_RE = /^([^:]{1,40}):\s*(.*)$/;

/** Estimate a duration when no following segment bounds it (~2.5 words/sec). */
function estimateDuration(text: string): number {
  return Math.max(1.2, Number((countWords(text) / 2.5).toFixed(2)));
}

/** Pull an optional "Speaker Name: text" prefix off a payload line. */
function splitSpeaker(body: string): { speaker: string; text: string } {
  const sm = SPEAKER_RE.exec(body);
  return sm ? { speaker: sm[1].trim(), text: sm[2].trim() } : { speaker: "", text: body };
}

/** Number cue ids + infer end times (next start, else estimated for the last). */
function finalise(parsed: { start: number; end?: number; speaker: string; text: string }[]): CaptionSegment[] {
  parsed.sort((a, b) => a.start - b.start);
  return parsed.map((seg, i) => {
    const next = parsed[i + 1];
    const end =
      seg.end != null && seg.end > seg.start
        ? seg.end
        : next && next.start > seg.start
          ? next.start
          : seg.start + estimateDuration(seg.text);
    return {
      id: `cap_${String(i + 1).padStart(3, "0")}`,
      start: seg.start,
      end: Number(end.toFixed(3)),
      speaker: seg.speaker,
      text: seg.text,
    };
  });
}

/** A WebVTT/SRT cue timing line: "HH:MM:SS.mmm --> HH:MM:SS.mmm" (',' ms also ok). */
const CUE_RE =
  /^(\d{1,2}:\d{2}:\d{2}[.,]\d+|\d{1,2}:\d{2}[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d+|\d{1,2}:\d{2}[.,]\d+)/;

/** A cue arrow anywhere in the text (unanchored) — used only for detection. */
const CUE_ANYWHERE = /\d{1,2}:\d{2}(?::\d{2})?[.,]\d+\s*-->/;

function isVtt(text: string): boolean {
  return /^﻿?\s*WEBVTT/.test(text) || CUE_ANYWHERE.test(text);
}

/**
 * Parse Zoom WebVTT (or SRT): WEBVTT header, numbered cues, a
 * "HH:MM:SS.mmm --> HH:MM:SS.mmm" timing line, then "Speaker Name: text". Uses
 * each cue's start + end and the speaker from the payload. This is the primary
 * caption upload format.
 */
function parseVtt(text: string): CaptionSegment[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const parsed: { start: number; end?: number; speaker: string; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = CUE_RE.exec(lines[i].trim());
    if (!m) continue;
    const startStr = m[1].replace(",", ".");
    const endStr = m[2].replace(",", ".");
    if (!isValidTimecode(startStr)) continue;

    // Collect payload lines until a blank line or the next cue timing line.
    const payload: string[] = [];
    for (i++; i < lines.length && lines[i].trim() !== "" && !CUE_RE.test(lines[i].trim()); i++) {
      payload.push(lines[i].trim());
    }
    i--; // step back so the outer loop re-examines the terminator line
    if (payload.length === 0) continue;

    const { speaker, text: body } = splitSpeaker(payload.join(" ").trim());
    parsed.push({
      start: parseTimecode(startStr),
      end: isValidTimecode(endStr) ? parseTimecode(endStr) : undefined,
      speaker,
      text: body,
    });
  }
  return finalise(parsed);
}

/** Parse the plain bracketed format: "[HH:MM:SS] Speaker Name: text" per line. */
function parseBracketed(text: string): CaptionSegment[] {
  const parsed: { start: number; speaker: string; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const ts = m[1];
    if (!isValidTimecode(ts)) continue;
    const { speaker, text: body } = splitSpeaker(m[2].trim());
    parsed.push({ start: parseTimecode(ts), speaker, text: body });
  }
  return finalise(parsed);
}

/**
 * Parse a transcript into ordered caption segments. Auto-detects Zoom WebVTT
 * (the primary upload format) vs. the plain "[HH:MM:SS] Speaker: text" format.
 */
export function parseTranscript(text: string): CaptionSegment[] {
  return isVtt(text) ? parseVtt(text) : parseBracketed(text);
}

/**
 * Split a caption at a character index into two captions. The time span is
 * divided in proportion to the split point in the text.
 */
export function splitCaptionSegment(seg: CaptionSegment, charIndex: number): [CaptionCore, CaptionCore] {
  const len = seg.text.length;
  const index = Math.max(0, Math.min(charIndex, len));
  const textA = seg.text.slice(0, index).trim();
  const textB = seg.text.slice(index).trim();

  const fraction = len > 0 ? index / len : 0.5;
  const mid = Number((seg.start + (seg.end - seg.start) * fraction).toFixed(3));

  return [
    { start: seg.start, end: mid, speaker: seg.speaker, text: textA },
    { start: mid, end: seg.end, speaker: seg.speaker, text: textB },
  ];
}

/** Merge two adjacent captions into one (text joined, span a.start → b.end). */
export function mergeCaptionSegments(a: CaptionSegment, b: CaptionSegment): CaptionCore {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return {
    start: first.start,
    end: Math.max(first.end, second.end),
    speaker: first.speaker || second.speaker,
    text: `${first.text} ${second.text}`.trim(),
  };
}

/* ── TimelineEvent conversion ───────────────────────────────────────────── */

export function captionToEvent(seg: CaptionCore & { id: string }): TimelineEvent {
  return {
    id: seg.id,
    kind: "caption",
    label: seg.text,
    start: seg.start,
    duration: Math.max(0.1, Number((seg.end - seg.start).toFixed(3))),
    track: TRACK.captions,
    enabled: true,
    locked: false,
    reviewRequired: false,
    confidence: 1,
    captionData: { speaker: seg.speaker, text: seg.text },
  };
}

export function eventToCaptionSegment(event: TimelineEvent): CaptionSegment {
  return {
    id: event.id,
    start: event.start,
    end: Number((event.start + event.duration).toFixed(3)),
    speaker: event.captionData?.speaker ?? "",
    text: event.captionData?.text ?? event.label,
  };
}
