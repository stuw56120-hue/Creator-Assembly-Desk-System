import { describe, expect, it } from "vitest";
import {
  EXCESS_WORDS,
  captionToEvent,
  countWords,
  eventToCaptionSegment,
  isCaptionTooLong,
  mergeCaptionSegments,
  parseTranscript,
  splitCaptionSegment,
  type CaptionSegment,
} from "./captions";

describe("countWords / isCaptionTooLong", () => {
  it("counts words and flags captions over the threshold", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  hello   world ")).toBe(2);
    expect(EXCESS_WORDS).toBe(7);
    expect(isCaptionTooLong("one two three four five six seven")).toBe(false); // exactly 7
    expect(isCaptionTooLong("one two three four five six seven eight")).toBe(true); // 8
  });
});

describe("parseTranscript", () => {
  const transcript = [
    "[00:00:01] Stuart: Welcome to the show.",
    "[00:00:04] Kulusevski had a great game.",
    "garbage line without timestamp",
    "[00:00:08] Stuart: That's all for today.",
  ].join("\n");

  it("parses [HH:MM:SS] Speaker: text with optional speaker, skipping junk", () => {
    const segs = parseTranscript(transcript);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ start: 1, speaker: "Stuart", text: "Welcome to the show." });
    expect(segs[1]).toMatchObject({ start: 4, speaker: "", text: "Kulusevski had a great game." });
    expect(segs[2]).toMatchObject({ start: 8, speaker: "Stuart" });
  });

  it("infers end times from the next segment's start", () => {
    const segs = parseTranscript(transcript);
    expect(segs[0].end).toBe(4);
    expect(segs[1].end).toBe(8);
    expect(segs[2].end).toBeGreaterThan(8); // last segment estimated
  });

  it("accepts [MM:SS] timestamps too", () => {
    const segs = parseTranscript("[01:30] A quick note.");
    expect(segs[0].start).toBe(90);
  });
});

describe("parseTranscript — Zoom WebVTT (primary format)", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:00:01.000 --> 00:00:04.500",
    "Stuart: Welcome to the show.",
    "",
    "2",
    "00:00:04.500 --> 00:00:08.000",
    "Kulusevski had a great game.",
    "",
    "3",
    "00:00:08.000 --> 00:00:11.250",
    "Stuart: That's all for today.",
    "",
  ].join("\n");

  it("parses cues using start timecode, end timecode, and speaker", () => {
    const segs = parseTranscript(vtt);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ start: 1, end: 4.5, speaker: "Stuart", text: "Welcome to the show." });
    expect(segs[1]).toMatchObject({ start: 4.5, end: 8, speaker: "", text: "Kulusevski had a great game." });
    expect(segs[2]).toMatchObject({ start: 8, end: 11.25, speaker: "Stuart", text: "That's all for today." });
  });

  it("detects VTT even without a WEBVTT header (cue arrow present)", () => {
    const segs = parseTranscript("00:00:02.000 --> 00:00:05.000\nSon: Great finish.");
    expect(segs[0]).toMatchObject({ start: 2, end: 5, speaker: "Son", text: "Great finish." });
  });

  it("handles SRT-style comma milliseconds", () => {
    const segs = parseTranscript("1\n00:00:01,000 --> 00:00:03,000\nHello there.");
    expect(segs[0]).toMatchObject({ start: 1, end: 3, text: "Hello there." });
  });

  it("joins multi-line cue payloads", () => {
    const segs = parseTranscript("WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nStuart: First line\nand second line.");
    expect(segs[0].text).toBe("First line and second line.");
    expect(segs[0].speaker).toBe("Stuart");
  });
});

describe("splitCaptionSegment", () => {
  const seg: CaptionSegment = { id: "c1", start: 10, end: 14, speaker: "Stuart", text: "hello there world" };

  it("splits text at the cursor and divides the span proportionally", () => {
    // "hello " ends at index 6 of 17 chars → mid ≈ 10 + 4*(6/17) = 11.412
    const [a, b] = splitCaptionSegment(seg, 6);
    expect(a.text).toBe("hello");
    expect(b.text).toBe("there world");
    expect(a.start).toBe(10);
    expect(b.end).toBe(14);
    expect(a.end).toBeCloseTo(11.412, 2);
    expect(b.start).toBe(a.end);
  });

  it("clamps an out-of-range cursor", () => {
    const [a, b] = splitCaptionSegment(seg, 999);
    expect(a.text).toBe("hello there world");
    expect(b.text).toBe("");
  });
});

describe("mergeCaptionSegments", () => {
  it("joins two captions into one span, keeping the first speaker", () => {
    const a: CaptionSegment = { id: "a", start: 10, end: 12, speaker: "Stuart", text: "First part" };
    const b: CaptionSegment = { id: "b", start: 12, end: 15, speaker: "", text: "second part" };
    expect(mergeCaptionSegments(a, b)).toEqual({
      start: 10,
      end: 15,
      speaker: "Stuart",
      text: "First part second part",
    });
  });

  it("orders by start time regardless of argument order", () => {
    const a: CaptionSegment = { id: "a", start: 12, end: 15, speaker: "B", text: "later" };
    const b: CaptionSegment = { id: "b", start: 10, end: 12, speaker: "A", text: "earlier" };
    expect(mergeCaptionSegments(a, b)).toMatchObject({ start: 10, end: 15, text: "earlier later" });
  });
});

describe("timeline event conversion", () => {
  it("round-trips a caption segment through a TimelineEvent", () => {
    const event = captionToEvent({ id: "c1", start: 10, end: 13.5, speaker: "Stuart", text: "Hi" });
    expect(event.kind).toBe("caption");
    expect(event.duration).toBe(3.5);
    expect(event.captionData).toEqual({ speaker: "Stuart", text: "Hi" });

    const back = eventToCaptionSegment(event);
    expect(back).toEqual({ id: "c1", start: 10, end: 13.5, speaker: "Stuart", text: "Hi" });
  });
});
