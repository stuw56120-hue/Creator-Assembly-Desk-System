/*
 * Tests for the ASS karaoke writer. Covers:
 *  • word-level \k timing (sums to total duration in centiseconds)
 *  • soft-wrap inserts \N hard breaks (libass WrapStyle=2)
 *  • ASS escapes for { } and \
 *  • time-offset round-trip (the handler maps before calling, so we trust
 *    the input is already in OUTPUT/short-local time)
 *  • single-word captions get one \k spanning the full duration (not \k0
 *    which would jump-cut instantly)
 *  • empty / whitespace captions are dropped silently
 *  • PlayResX / PlayResY scale to the requested frame
 *  • partitionCaptionsByStyle sends everything to the right bucket
 */

import { describe, expect, it } from "vitest";
import {
  assTime,
  buildAssContent,
  buildKaraokeDialogueBody,
  escapeAssText,
  karaokeWrapChars,
  partitionCaptionsByStyle,
} from "./assBuilder";

describe("assTime", () => {
  it("formats H:MM:SS.cs with centisecond precision", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(1.234)).toBe("0:00:01.23");
    expect(assTime(63.999)).toBe("0:01:04.00"); // rounds to 6400 cs
    expect(assTime(3725.05)).toBe("1:02:05.05");
  });

  it("clamps negative values to zero", () => {
    expect(assTime(-1)).toBe("0:00:00.00");
  });
});

describe("escapeAssText", () => {
  it("escapes the ASS override delimiters and backslash", () => {
    expect(escapeAssText("a{b}c")).toBe("a\\{b\\}c");
    expect(escapeAssText("path\\sub")).toBe("path\\\\sub");
  });

  it("leaves apostrophes, commas, quotes alone", () => {
    expect(escapeAssText("It's a quote, \"x\"")).toBe("It's a quote, \"x\"");
  });
});

describe("buildKaraokeDialogueBody", () => {
  it("distributes centiseconds evenly with the remainder dribbled into early words", () => {
    // 4 words, 100 cs total → 25 each
    const body = buildKaraokeDialogueBody(["a", "b", "c", "d"], 100, 999);
    expect(body).toBe("{\\k25}a {\\k25}b {\\k25}c {\\k25}d");
    // 3 words, 100 cs → 33 + 33 + 33 = 99, remainder 1 → first word gets +1
    const body2 = buildKaraokeDialogueBody(["a", "b", "c"], 100, 999);
    expect(body2).toBe("{\\k34}a {\\k33}b {\\k33}c");
    // The sum equals the requested total (no drift across many words)
    const ks = (s: string) => [...s.matchAll(/\\k(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(ks(body)).toBe(100);
    expect(ks(body2)).toBe(100);
  });

  it("single word gets one \\k spanning the full duration (not \\k0)", () => {
    expect(buildKaraokeDialogueBody(["solo"], 250)).toBe("{\\k250}solo");
  });

  it("inserts \\N when a word would push the visible length past maxCharsPerLine", () => {
    // 10-char limit. "alpha bravo" = 11 visible → "bravo" goes on line 2.
    const body = buildKaraokeDialogueBody(["alpha", "bravo", "charlie"], 60, 10);
    expect(body).toContain("\\N");
    // Sum of \k still equals the requested duration.
    const ks = (s: string) => [...s.matchAll(/\\k(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(ks(body)).toBe(60);
    // Every word should appear, in order.
    const wordOrder = body.replace(/\{\\k\d+\}/g, "").replace(/\\N/g, " ").trim().split(/\s+/);
    expect(wordOrder).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("escapes literal { } in word text", () => {
    const body = buildKaraokeDialogueBody(["a{b}c"], 100);
    expect(body).toBe("{\\k100}a\\{b\\}c");
  });

  it("empty word list → empty body", () => {
    expect(buildKaraokeDialogueBody([], 100)).toBe("");
  });
});

describe("buildAssContent", () => {
  const ONE_CAP = [{ outStart: 1, duration: 3, text: "Hello karaoke world" }];

  it("emits a v4+ header with PlayRes matching the frame", () => {
    const ass = buildAssContent(ONE_CAP, { width: 1080, height: 1920 });
    expect(ass).toMatch(/^\[Script Info\]/);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("\n[V4+ Styles]\n");
    expect(ass).toContain("\n[Events]\n");
  });

  it("emits a Karaoke style with gold primary + white secondary + dark band", () => {
    const ass = buildAssContent(ONE_CAP);
    // PrimaryColour = highlighted (gold #ffd84a, BGR 4AD8FF)
    expect(ass).toContain("&H004AD8FF");
    // SecondaryColour = white
    expect(ass).toContain("&H00FFFFFF");
    // BorderStyle 3 = opaque box (the dark band)
    expect(ass).toMatch(/Style: Karaoke,Arial,\d+,&H004AD8FF,&H00FFFFFF,&H80000000,&H61000000,1,0,0,0,100,100,0,0,3,2,0,2,/);
  });

  it("each Dialogue carries a karaoke body with summed \\k matching its duration", () => {
    const ass = buildAssContent([
      { outStart: 0, duration: 2, text: "one two three four" },
      { outStart: 5, duration: 1, text: "alpha bravo" },
    ]);
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(2);
    const sumK = (s: string) => [...s.matchAll(/\\k(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(sumK(dialogues[0])).toBe(200); // 2.0s = 200 cs
    expect(sumK(dialogues[1])).toBe(100); // 1.0s = 100 cs
    expect(dialogues[0]).toMatch(/^Dialogue: 0,0:00:00\.00,0:00:02\.00,Karaoke,,0,0,0,,/);
    expect(dialogues[1]).toMatch(/^Dialogue: 0,0:00:05\.00,0:00:06\.00,Karaoke,,0,0,0,,/);
  });

  it("drops captions that are empty / whitespace / pure markup", () => {
    const ass = buildAssContent([
      { outStart: 0, duration: 1, text: "" },
      { outStart: 1, duration: 1, text: "   " },
      { outStart: 2, duration: 1, text: "<i></i>" },
      { outStart: 3, duration: 1, text: "real text" },
    ]);
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBe(1);
    expect(dialogues[0]).toContain("real");
  });

  it("returns empty string when nothing survives sanitisation (handler then skips file write)", () => {
    expect(buildAssContent([{ outStart: 0, duration: 1, text: "" }])).toBe("");
    expect(buildAssContent([])).toBe("");
  });

  it("strips HTML and SSA inline tags before splitting words", () => {
    const ass = buildAssContent([{ outStart: 0, duration: 1, text: "<b>bold</b> {\\an8}drop" }]);
    expect(ass).toContain("bold");
    expect(ass).toContain("drop");
    expect(ass).not.toContain("<b>");
    expect(ass).not.toContain("{\\an8}");
  });
});

describe("karaokeWrapChars (Bug 6 — caption width)", () => {
  it("wraps a 9:16 portrait frame far tighter than landscape", () => {
    const portrait = karaokeWrapChars({ width: 1080, height: 1920 });
    const landscape = karaokeWrapChars({ width: 1920, height: 1080 });
    expect(portrait).toBeLessThan(landscape);
    expect(portrait).toBeLessThanOrEqual(26); // fits within 1080px with safe-area padding
    expect(landscape).toBe(42); // landscape stays at the readability cap
  });

  it("a long single-line caption wraps in portrait but not in landscape", () => {
    const cap = [{ outStart: 0, duration: 3, text: "Spurs survive on the final day again" }]; // ~36 chars
    const portrait = buildAssContent(cap, { width: 1080, height: 1920 });
    const landscape = buildAssContent(cap, { width: 1920, height: 1080 });
    const dialogueOf = (ass: string) => ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
    expect(dialogueOf(portrait)).toContain("\\N"); // forced break to stay within 1080px
    expect(dialogueOf(landscape)).not.toContain("\\N"); // fits a 1920px line
  });

  it("portrait style header carries width-proportional safe-area margins", () => {
    const ass = buildAssContent([{ outStart: 0, duration: 1, text: "hi" }], { width: 1080, height: 1920 });
    // MarginL/MarginR = round(1080*0.06) = 65 (was a fixed 40 before the fix).
    expect(ass).toMatch(/Style: Karaoke,Arial,\d+,[^\n]*,3,2,0,2,65,65,/);
  });
});

describe("partitionCaptionsByStyle", () => {
  const CAPS = [
    { outStart: 0, duration: 1, text: "a" },
    { outStart: 1, duration: 1, text: "b" },
  ];

  it("karaoke_highlight → all to ASS bucket", () => {
    const { ass, srt } = partitionCaptionsByStyle(CAPS, "karaoke_highlight");
    expect(ass.length).toBe(2);
    expect(srt.length).toBe(0);
  });

  it("any other style → all to SRT bucket", () => {
    for (const style of ["clean_podcast", "bold_social", "quote_emphasis", undefined]) {
      const { ass, srt } = partitionCaptionsByStyle(CAPS, style);
      expect(ass.length).toBe(0);
      expect(srt.length).toBe(2);
    }
  });
});
