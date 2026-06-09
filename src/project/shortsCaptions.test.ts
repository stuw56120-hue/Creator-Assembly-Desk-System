import { describe, expect, it } from "vitest";
import {
  buildShortsCaptions,
  parseVttWords,
  placeSegmentWords,
  shortsCaptionWrapChars,
  type VttWord,
} from "./shortsCaptions";

describe("parseVttWords", () => {
  const vtt = [
    "WEBVTT",
    "",
    "1",
    "00:00:00.000 --> 00:00:02.000",
    "Stuart: One two three four",
    "",
    "2",
    "00:00:10.000 --> 00:00:11.000",
    "<v Ash>Five six</v>",
    "",
  ].join("\n");

  it("splits cue duration evenly across words and strips speaker labels + tags", () => {
    const words = parseVttWords(vtt);
    // cue 1: "One two three four" over 2s → 0.5s each, speaker "Stuart:" stripped
    expect(words.slice(0, 4).map((w) => w.text)).toEqual(["One", "two", "three", "four"]);
    expect(words[0]).toMatchObject({ start: 0, end: 0.5 });
    expect(words[2]).toMatchObject({ start: 1, end: 1.5 });
    // cue 2: inline tags stripped
    expect(words.slice(4).map((w) => w.text)).toEqual(["Five", "six"]);
    expect(words[4].start).toBe(10);
  });

  it("returns [] for a transcript with no cues", () => {
    expect(parseVttWords("WEBVTT\n\nnotes only")).toEqual([]);
  });
});

describe("shortsCaptionWrapChars", () => {
  it("keeps a shorts_bold line within the 920px safe width", () => {
    const maxChars = shortsCaptionWrapChars("shorts_bold");
    // 64px font, ~0.5em glyph → maxChars · 32px must not exceed 920px.
    expect(maxChars * 64 * 0.5).toBeLessThanOrEqual(920);
    expect(maxChars).toBeGreaterThan(20); // still a usable line length
  });

  it("kinetic (72px, 900px) wraps tighter than bold", () => {
    expect(shortsCaptionWrapChars("shorts_kinetic")).toBeLessThan(shortsCaptionWrapChars("shorts_bold"));
  });
});

describe("placeSegmentWords (re-offset to assembled timeline)", () => {
  const words: VttWord[] = [
    { text: "alpha", start: 100, end: 101 },
    { text: "bravo", start: 101, end: 102 },
    { text: "charlie", start: 200, end: 201 }, // outside the segment
  ];

  it("keeps in-range words and offsets them to the assembled position", () => {
    const placed = placeSegmentWords(words, 100, 110, 20, new Set(["bravo"]));
    expect(placed.map((w) => w.text)).toEqual(["alpha", "bravo"]);
    // alpha at source 100 → segment start → output offset 20.
    expect(placed[0].outStart).toBe(20);
    // bravo at source 101 → 20 + (101-100) = 21, and it is emphasised.
    expect(placed[1].outStart).toBe(21);
    expect(placed[1].emphasised).toBe(true);
    expect(placed[0].emphasised).toBe(false);
  });
});

describe("buildShortsCaptions", () => {
  const words: VttWord[] = [
    { text: "Spurs", start: 0, end: 0.5 },
    { text: "survive", start: 0.5, end: 1 },
    { text: "again", start: 1, end: 1.5 },
  ];
  const plan = {
    segments: [{ inSeconds: 0, outSeconds: 2, emphasis: ["survive"] }],
    words,
    captionStyle: "shorts_bold",
  };

  it("emits a v4+ header with portrait PlayRes, 64px Shorts style and 80px safe margins", () => {
    const ass = buildShortsCaptions(plan);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    // (1080-920)/2 = 80px MarginL/MarginR; Alignment 2; size 64.
    expect(ass).toMatch(/Style: Shorts,Arial,64,[^\n]*,2,80,80,/);
  });

  it("colours an emphasis word with the yellow override tag", () => {
    const ass = buildShortsCaptions(plan);
    expect(ass).toContain("{\\1c&H0000D7FF}survive{\\1c&H00FFFFFF}");
    expect(ass).not.toContain("{\\1c&H0000D7FF}Spurs"); // non-emphasis word stays default
  });

  it("offsets caption timing to the segment's assembled position", () => {
    const multi = {
      segments: [
        { inSeconds: 0, outSeconds: 5, emphasis: [] }, // offset 0
        { inSeconds: 100, outSeconds: 110, emphasis: [] }, // offset 5
      ],
      words: [
        { text: "early", start: 1, end: 1.5 },
        { text: "later", start: 102, end: 102.5 }, // in segment 2 → 5 + (102-100) = 7
      ],
      captionStyle: "shorts_bold",
    };
    const ass = buildShortsCaptions(multi);
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    // "later" dialogue starts at assembled t=7.0 → 0:00:07.00
    expect(dialogues.some((d) => d.includes("0:00:07.00") && d.includes("later"))).toBe(true);
  });

  it("wraps long captions so no line exceeds the 920px-safe width", () => {
    const longWords: VttWord[] = Array.from({ length: 14 }, (_, i) => ({
      text: "supercalifragi", // 14 chars
      start: i * 0.4,
      end: i * 0.4 + 0.4,
    }));
    const ass = buildShortsCaptions({ segments: [{ inSeconds: 0, outSeconds: 6, emphasis: [] }], words: longWords, captionStyle: "shorts_bold" });
    const maxChars = shortsCaptionWrapChars("shorts_bold");
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBeGreaterThan(0);
    for (const d of dialogues) {
      const text = d.split(",,")[1] ?? "";
      for (const line of text.split("\\N")) {
        const visible = line.replace(/\{[^}]*\}/g, ""); // strip {\k..}/{\1c..} tags
        expect(visible.length).toBeLessThanOrEqual(maxChars);
      }
    }
  });

  it("returns an empty string when no words fall in any segment", () => {
    const ass = buildShortsCaptions({ segments: [{ inSeconds: 500, outSeconds: 510, emphasis: [] }], words, captionStyle: "shorts_bold" });
    expect(ass).toBe("");
  });

  it("caps shorts_bold at 3 words per line (SS-6)", () => {
    // Eight short words → would fit on one width-wrapped line, but the 3-word
    // cap must break them into lines of at most 3.
    const shortWords: VttWord[] = "one two three four five six seven eight".split(" ").map((t, i) => ({
      text: t,
      start: i * 0.5,
      end: i * 0.5 + 0.5,
    }));
    const ass = buildShortsCaptions({ segments: [{ inSeconds: 0, outSeconds: 5, emphasis: [] }], words: shortWords, captionStyle: "shorts_bold" });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues.length).toBeGreaterThan(0);
    for (const d of dialogues) {
      const text = d.split(",,")[1] ?? "";
      for (const line of text.split("\\N")) {
        const wordCount = (line.match(/\{\\k\d+\}/g) || []).length; // one {\k} per word
        expect(wordCount).toBeLessThanOrEqual(3);
      }
    }
  });
});
