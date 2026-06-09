import { describe, expect, it } from "vitest";
import {
  boundaryEffect,
  buildLongformRenderArgs,
  buildShortRenderArgs,
  buildShortsSegmentArgs,
  buildShortStillsArgs,
  buildSrtContent,
  xstackLayout,
  captionForceStyle,
  mapCaptionsForLongform,
  mapCaptionsForShort,
  outputDuration,
  pickDominantCaptionStyle,
  placementExpr,
  sourceToOutputTime,
  type ShortsSegmentRenderPlan,
} from "./renderExporter";
import { EditListSchema } from "./editListParser";
import { buildTimeline } from "./timelineBuilder";
import sweetRelief from "./__fixtures__/sweet-relief.json";

const editList = EditListSchema.parse(sweetRelief);

describe("sourceToOutputTime", () => {
  // One cut: source [10,12] removed → keep [0,10] and [12,end].
  const keep = [
    { start: 0, end: 10 },
    { start: 12, end: 100 },
  ];

  it("is identity before any cut", () => {
    expect(sourceToOutputTime(5, keep)).toBe(5);
  });

  it("subtracts removed duration after a cut", () => {
    expect(sourceToOutputTime(20, keep)).toBe(18); // 2s removed before
  });

  it("maps a time inside a removed gap to the end of the prior kept span", () => {
    expect(sourceToOutputTime(11, keep)).toBe(10);
  });
});

describe("outputDuration", () => {
  it("sums the kept spans", () => {
    expect(outputDuration([{ start: 0, end: 10 }, { start: 12, end: 100 }])).toBe(98);
  });
});

describe("placementExpr", () => {
  it("maps known placements to ffmpeg overlay expressions", () => {
    // Corners use a halved horizontal inset (20 px) and the standard 40 px vertical.
    expect(placementExpr("lower_right")).toEqual({ x: "W-w-20", y: "H-h-40" });
    expect(placementExpr("upper_left")).toEqual({ x: "20", y: "40" });
    // Side placements keep their 40 px inset.
    expect(placementExpr("left_center")).toEqual({ x: "40", y: "(H-h)/2" });
    expect(placementExpr("center")).toEqual({ x: "(W-w)/2", y: "(H-h)/2" });
  });

  it("falls back to centre for unknown placements", () => {
    expect(placementExpr("nonsense")).toEqual({ x: "(W-w)/2", y: "(H-h)/2" });
  });

  it("accepts the director's top_/bottom_ aliases", () => {
    expect(placementExpr("top_right")).toEqual(placementExpr("upper_right"));
    expect(placementExpr("bottom_left")).toEqual(placementExpr("lower_left"));
    expect(placementExpr("top_center")).toEqual({ x: "(W-w)/2", y: "40" });
    expect(placementExpr("bottom_center")).toEqual({ x: "(W-w)/2", y: "H-h-40" });
  });
});

describe("buildLongformRenderArgs", () => {
  const keep = [
    { start: 0, end: 10 },
    { start: 12, end: 100 },
  ];

  it("inputs the source then each overlay, in order", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [
        { inputPath: "mg1.webm", sourceStart: 5, duration: 3, placement: "left_center" },
        { inputPath: "mg2.webm", sourceStart: 50, duration: 2, placement: "lower_right" },
      ],
      outputPath: "out.mp4",
    });
    // -i src.mp4, then each WebM overlay decoded with libvpx-vp9 (for VP9 alpha).
    expect(args.slice(0, 10)).toEqual([
      "-i",
      "src.mp4",
      "-c:v",
      "libvpx-vp9",
      "-i",
      "mg1.webm",
      "-c:v",
      "libvpx-vp9",
      "-i",
      "mg2.webm",
    ]);
    expect(args).toContain("out.mp4");
  });

  it("forces the libvpx-vp9 decoder before each WebM overlay (exposes VP9 alpha)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [{ inputPath: "mg.webm", sourceStart: 5, duration: 3, placement: "center" }],
      outputPath: "out.mp4",
    });
    const i = args.indexOf("mg.webm");
    expect(args.slice(i - 3, i + 1)).toEqual(["-c:v", "libvpx-vp9", "-i", "mg.webm"]);
  });

  it("applies composite opacity via colorchannelmixer when opacity < 1", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [
        { inputPath: "mg.webm", sourceStart: 5, duration: 3, placement: "center", fullFrame: true, opacity: 0.5 },
      ],
      outputPath: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("colorchannelmixer=aa=0.500");
  });

  it("omits the opacity filter at full opacity (opaque overlays unchanged)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [
        { inputPath: "mg.webm", sourceStart: 5, duration: 3, placement: "center", fullFrame: true, opacity: 1 },
      ],
      outputPath: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).not.toContain("colorchannelmixer");
  });

  it("does NOT force a decoder for non-WebM (image) overlays", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [{ inputPath: "still.png", sourceStart: 5, duration: 3, placement: "center" }],
      outputPath: "out.mp4",
    });
    const i = args.indexOf("still.png");
    expect(args[i - 1]).toBe("-i");
    expect(args[i - 2]).not.toBe("libvpx-vp9");
  });

  it("concatenates one segment per keep span", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [],
      outputPath: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("concat=n=2:v=1:a=1[cv][ca]");
    expect(fc).toContain("trim=start=0:end=10");
    expect(fc).toContain("trim=start=12:end=100");
    // No overlays → final video label is [cv].
    expect(args[args.indexOf("-map") + 1]).toBe("[cv]");
  });

  it("chains overlays at OUTPUT timecodes and maps the final label", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [
        { inputPath: "mg1.webm", sourceStart: 5, duration: 3, placement: "left_center" }, // before cut → out 5
        { inputPath: "mg2.webm", sourceStart: 50, duration: 2, placement: "lower_right" }, // after cut → out 48
      ],
      outputPath: "out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[cv][1:v]overlay=x=40:y=(H-h)/2:enable='between(t,5,8)'[ov0]");
    expect(fc).toContain("[ov0][2:v]overlay=x=W-w-20:y=H-h-40:enable='between(t,48,50)'[outv]");
    expect(args[args.indexOf("-map") + 1]).toBe("[outv]");
    expect(args).toContain("[ca]");
  });

  it("uses the default encode flags when no preset is given (unchanged behaviour)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [],
      outputPath: "out.mp4",
    });
    expect(args).toContain("-c:v");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args).not.toContain("-crf"); // no preset → no crf/preset flags
  });

  it("applies a supplied encode preset (crf/preset/codec)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "src.mp4",
      keepSegments: keep,
      overlays: [],
      outputPath: "out.mp4",
      preset: { videoCodec: "libx264", pixelFormat: "yuv420p", audioCodec: "aac", preset: "medium", crf: 20 },
    });
    expect(args[args.indexOf("-crf") + 1]).toBe("20");
    expect(args[args.indexOf("-preset") + 1]).toBe("medium");
    expect(args[args.indexOf("-map") + 1]).toBe("[cv]"); // mapping unaffected
  });

  it("builds a valid plan for the real Sweet Relief timeline", () => {
    const { keepSegments, events } = buildTimeline(editList);
    const overlays = events
      .filter((e) => e.kind === "motion_graphic" && e.enabled)
      .map((e) => ({
        inputPath: e.overlayData?.assetPath || "x.webm",
        sourceStart: e.start,
        duration: e.duration,
        placement: e.overlayData?.placement ?? "center",
      }));
    const args = buildLongformRenderArgs({
      sourcePath: "sweet-relief.mp4",
      keepSegments,
      overlays,
      outputPath: "sweet-relief-longform.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    // 26 enabled cuts → 27 keep spans tiling the 2528s source.
    expect(fc).toContain(`concat=n=${keepSegments.length}:v=1:a=1[cv][ca]`);
    expect(args[args.indexOf("-map") + 1]).toBe("[outv]"); // 2 motion graphics overlaid
  });
});

describe("buildLongformRenderArgs — transitions", () => {
  const keep = [
    { start: 0, end: 10 },
    { start: 12, end: 100 },
  ];

  it("adds nothing when there are no transitions (unchanged args)", () => {
    const fc = (transitions?: { sourceStart: number; type: string }[]) =>
      buildLongformRenderArgs({ sourcePath: "s.mp4", keepSegments: keep, overlays: [], transitions, outputPath: "o.mp4" })[
        buildLongformRenderArgs({ sourcePath: "s.mp4", keepSegments: keep, overlays: [], transitions, outputPath: "o.mp4" }).indexOf("-filter_complex") + 1
      ];
    expect(fc(undefined)).toBe(fc([]));
    expect(fc(undefined)).not.toContain("drawbox");
    expect(fc(undefined)).not.toContain("split=2");
  });

  it("renders smash_cut as a white flash at the OUTPUT time", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      transitions: [{ sourceStart: 50, type: "smash_cut" }], // after the cut → output 48
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[cv]drawbox=x=0:y=0:w=iw:h=ih:color=white@0.92:t=fill:enable='between(t,48,48.15)'[txflash]");
    expect(args[args.indexOf("-map") + 1]).toBe("[txflash]");
  });

  it("normalizes the transition type (Smash Cut / smash-cut → smash_cut)", () => {
    for (const type of ["Smash Cut", "smash-cut", "SMASH_CUT"]) {
      const args = buildLongformRenderArgs({
        sourcePath: "s.mp4",
        keepSegments: keep,
        overlays: [],
        transitions: [{ sourceStart: 50, type }],
        outputPath: "o.mp4",
      });
      const fc = args[args.indexOf("-filter_complex") + 1];
      expect(fc).toContain("drawbox"); // triggered despite the casing/spacing
    }
  });

  it("renders punch_zoom as a split+scale+crop+overlay zoom", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      transitions: [{ sourceStart: 5, type: "punch_zoom" }], // before the cut → output 5
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[cv]split=2[txzbase][txzsrc]");
    expect(fc).toContain("[txzsrc]scale=iw*1.22:ih*1.22,crop=iw/1.22:ih/1.22[txzoomed]");
    expect(fc).toContain("[txzbase][txzoomed]overlay=x=0:y=0:enable='between(t,5,5.35)'[txv]");
    expect(args[args.indexOf("-map") + 1]).toBe("[txv]");
  });

  it("renders slide_left as a frame sliding in from the right", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      transitions: [{ sourceStart: 5, type: "slide_left" }],
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[cv]split=2[slbase][slsrc]");
    expect(fc).toContain("W-W*(t-5)/0.35"); // slides in over 0.35s
    expect(args[args.indexOf("-map") + 1]).toBe("[slv]");
  });

  it("leaves genuinely unsupported transitions as markers (e.g. fade_cross)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      transitions: [{ sourceStart: 5, type: "fade_cross" }],
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).not.toContain("drawbox");
    expect(fc).not.toContain("split=2");
    expect(args[args.indexOf("-map") + 1]).toBe("[cv]"); // unchanged
  });

  it("feeds transitions into the overlay chain (flash then overlay)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [{ inputPath: "mg.webm", sourceStart: 5, duration: 3, placement: "center" }],
      transitions: [{ sourceStart: 5, type: "smash_cut" }],
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    // overlay chains on the flash output, not raw [cv].
    expect(fc).toContain("[txflash][1:v]overlay=");
    expect(args[args.indexOf("-map") + 1]).toBe("[outv]");
  });
});

describe("buildLongformRenderArgs — store positions → pixel coords", () => {
  const oneSegment = [{ start: 0, end: 100 }];

  it("scales an image to its normalised width and centres it on x·W, y·H", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: oneSegment,
      overlays: [
        { inputPath: "p.png", sourceStart: 5, duration: 3, placement: "center", x: 0.5, y: 0.5, width: 0.25 },
      ],
      outputPath: "o.mp4",
      frameWidth: 1280,
      frameHeight: 720,
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[1:v]scale=320:-2[ovs0]"); // 0.25 * 1280 = 320 (even)
    expect(fc).toContain("[cv][ovs0]overlay=x=640-w/2:y=360-h/2:enable='between(t,5,8)'[outv]");
  });

  it("composites motion graphics full-frame (scaled to the output)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: oneSegment,
      overlays: [
        { inputPath: "mg.webm", sourceStart: 0, duration: 2, placement: "center", fullFrame: true },
      ],
      outputPath: "o.mp4",
      frameWidth: 1280,
      frameHeight: 720,
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("[1:v]scale=1280:720[ovs0]");
    expect(fc).toContain("[cv][ovs0]overlay=x=0:y=0:enable='between(t,0,2)'[outv]");
  });

  it("falls back to the placement keyword when no x/y/width is given (unchanged)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: oneSegment,
      overlays: [{ inputPath: "mg.webm", sourceStart: 5, duration: 3, placement: "lower_right" }],
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).not.toContain("scale="); // no scaling on the placement path
    expect(fc).toContain("[cv][1:v]overlay=x=W-w-20:y=H-h-40:enable='between(t,5,8)'[outv]");
  });
});

describe("captions — SRT + subtitles filter", () => {
  const keep = [
    { start: 0, end: 10 },
    { start: 12, end: 100 },
  ];
  const SRT = "C:/Users/statt/AppData/Local/Temp/cads-caps-123.srt";

  it("appends a single subtitles filter pointing at the SRT (longform)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      subtitlesFilePath: SRT,
      captionStyle: "clean_podcast",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("subtitles=filename='C\\:/Users/statt/AppData/Local/Temp/cads-caps-123.srt'");
    expect(fc).toContain("force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF");
    expect(fc).not.toContain("drawtext"); // gone for good
    // Only one subtitles filter, not one-per-caption.
    expect((fc.match(/subtitles=/g) ?? []).length).toBe(1);
    expect(args[args.indexOf("-map") + 1]).toBe("[subs]");
  });

  it("does NOT use single-quoted enable expressions any more", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      subtitlesFilePath: SRT,
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).not.toMatch(/enable='between/);
  });

  it("bold_social sets yellow + bold in force_style", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      subtitlesFilePath: SRT,
      captionStyle: "bold_social",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("PrimaryColour=&H0000FFFF"); // ASS BGR yellow
    expect(fc).toContain("FontSize=24");
    expect(fc).toContain("Outline=2"); // not Outline=3 — spec lists only Outline=2
    expect(fc).not.toContain("Bold=1"); // bold_social uses yellow font weight, not Bold=1 (spec)
  });

  it("quote_emphasis sets italic white at the default FontSize=20", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      subtitlesFilePath: SRT,
      captionStyle: "quote_emphasis",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("Italic=1");
    expect(fc).toContain("PrimaryColour=&H00FFFFFF");
    expect(fc).toContain("FontSize=20");
  });

  it("shorts get a subtitles filter when subtitlesFilePath is set", () => {
    const args = buildShortRenderArgs({
      sourcePath: "s.mp4",
      inSeconds: 100,
      outSeconds: 160,
      overlays: [],
      subtitlesFilePath: SRT,
      captionStyle: "clean_podcast",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("subtitles=filename='C\\:/Users/statt/AppData/Local/Temp/cads-caps-123.srt'");
    expect(args[args.indexOf("-map") + 1]).toBe("[subs]");
  });

  it("no SRT path → no subtitles filter (regression guard)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).not.toContain("subtitles=");
    expect(args[args.indexOf("-map") + 1]).toBe("[cv]");
  });

  // ── Karaoke ASS path ───────────────────────────────────────────────────────
  const ASS = "C:/Users/statt/AppData/Local/Temp/cads-caps-456.ass";

  it("longform: ASS-only render uses one subtitles filter with no force_style (karaoke)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      assFilePath: ASS,
      captionStyle: "karaoke_highlight",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("subtitles=filename='C\\:/Users/statt/AppData/Local/Temp/cads-caps-456.ass'");
    // ASS has its own [V4+ Styles] block — no force_style on the ASS filter.
    expect(fc).not.toMatch(/cads-caps-456\.ass'[^[]*force_style/);
    expect((fc.match(/subtitles=/g) ?? []).length).toBe(1);
    expect(args[args.indexOf("-map") + 1]).toBe("[subs]");
  });

  it("shorts: ASS-only render uses one subtitles filter (karaoke)", () => {
    const args = buildShortRenderArgs({
      sourcePath: "s.mp4",
      inSeconds: 100,
      outSeconds: 160,
      overlays: [],
      assFilePath: ASS,
      captionStyle: "karaoke_highlight",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("subtitles=filename='C\\:/Users/statt/AppData/Local/Temp/cads-caps-456.ass'");
    expect((fc.match(/subtitles=/g) ?? []).length).toBe(1);
    expect(args[args.indexOf("-map") + 1]).toBe("[subs]");
  });

  it("mixed-style render chains SRT then ASS (both filters present)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      subtitlesFilePath: SRT,
      assFilePath: ASS,
      captionStyle: "clean_podcast",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    // Two subtitles filters in the graph.
    expect((fc.match(/subtitles=/g) ?? []).length).toBe(2);
    // SRT comes first and feeds the intermediate label that the ASS filter reads.
    const srtIdx = fc.indexOf("cads-caps-123.srt");
    const assIdx = fc.indexOf("cads-caps-456.ass");
    expect(srtIdx).toBeGreaterThanOrEqual(0);
    expect(assIdx).toBeGreaterThan(srtIdx);
    expect(fc).toContain("[srtsubs]");
    expect(args[args.indexOf("-map") + 1]).toBe("[subs]");
  });

  it("no ASS, no SRT, but karaoke style → no subtitles filter (regression guard)", () => {
    const args = buildLongformRenderArgs({
      sourcePath: "s.mp4",
      keepSegments: keep,
      overlays: [],
      captionStyle: "karaoke_highlight",
      outputPath: "o.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).not.toContain("subtitles=");
  });
});

describe("captionForceStyle", () => {
  it("defaults to clean_podcast (white, FontSize=20)", () => {
    const s = captionForceStyle(undefined);
    expect(s).toContain("FontSize=20");
    expect(s).toContain("PrimaryColour=&H00FFFFFF");
    expect(s).toContain("Alignment=2"); // bottom-centre
  });
});

describe("pickDominantCaptionStyle", () => {
  it("returns the most common style", () => {
    expect(pickDominantCaptionStyle(["bold_social", "bold_social", "clean_podcast"])).toBe("bold_social");
  });
  it("defaults to clean_podcast on a tie", () => {
    expect(pickDominantCaptionStyle(["bold_social", "quote_emphasis"])).toBe("clean_podcast");
  });
  it("defaults to clean_podcast for empty / all-undefined input", () => {
    expect(pickDominantCaptionStyle([])).toBe("clean_podcast");
    expect(pickDominantCaptionStyle([undefined, undefined])).toBe("clean_podcast");
  });
});

describe("buildSrtContent", () => {
  it("writes a numbered SRT block per caption with HH:MM:SS,mmm timecodes", () => {
    const out = buildSrtContent([
      { outStart: 0, duration: 1.5, text: "Hello" },
      { outStart: 3.25, duration: 2, text: "Don't worry" }, // apostrophe — no escaping needed in SRT
    ]);
    expect(out).toContain("1\n00:00:00,000 --> 00:00:01,500\nHello");
    expect(out).toContain("2\n00:00:03,250 --> 00:00:05,250\nDon't worry");
  });

  it("returns an empty string for an empty caption list", () => {
    expect(buildSrtContent([])).toBe("");
  });

  it("soft-wraps caption text at ~42 chars on word boundaries", () => {
    const out = buildSrtContent([
      {
        outStart: 0,
        duration: 5,
        text: "The quick brown fox jumps over the lazy dog and keeps running through the night",
      },
    ]);
    // No SRT body line may exceed the 42-char target.
    const bodyLines = out.split("\n").filter((l) => l.length > 0 && !/^(\d+|\d{2}:\d{2}:)/.test(l));
    expect(bodyLines.length).toBeGreaterThan(1);
    for (const l of bodyLines) expect(l.length).toBeLessThanOrEqual(42);
  });

  it("strips HTML tags and SSA inline overrides from the body", () => {
    const out = buildSrtContent([
      {
        outStart: 0,
        duration: 1,
        text: "<i>Hello</i> <b>world</b> {\\b1}bold{\\b0} {\\an8}up",
      },
    ]);
    expect(out).toContain("Hello world bold up");
    expect(out).not.toContain("<i>");
    expect(out).not.toContain("{\\b1}");
  });

  it("drops captions whose text is empty after sanitisation and renumbers the rest", () => {
    const out = buildSrtContent([
      { outStart: 0, duration: 1, text: "Hello" },
      { outStart: 1.5, duration: 0.5, text: "<b></b>   " }, // empty after strip+trim
      { outStart: 2, duration: 1, text: "World" },
    ]);
    expect(out.startsWith("1\n00:00:00,000")).toBe(true);
    // Surviving cues are renumbered 1, 2 — no number 3, no gap.
    expect(out).toContain("2\n00:00:02,000 --> 00:00:03,000\nWorld");
    expect(out).not.toMatch(/^3\n/m);
  });

  it("preserves apostrophes and quotation marks verbatim", () => {
    const out = buildSrtContent([
      { outStart: 0, duration: 1, text: "Don't \"quote me\" on that" },
    ]);
    expect(out).toContain(`Don't "quote me" on that`);
  });
});

describe("mapCaptionsForLongform", () => {
  it("maps source time to OUTPUT time through cut keep-segments", () => {
    const keep = [{ start: 0, end: 10 }, { start: 12, end: 100 }];
    const mapped = mapCaptionsForLongform(
      [
        { sourceStart: 5, duration: 1, text: "before cut" }, // → 5
        { sourceStart: 50, duration: 2, text: "after cut" }, // → 48
      ],
      keep,
    );
    expect(mapped).toEqual([
      { outStart: 5, duration: 1, text: "before cut" },
      { outStart: 48, duration: 2, text: "after cut" },
    ]);
  });
});

describe("mapCaptionsForShort", () => {
  it("filters captions to the span and offsets to short-local time", () => {
    const mapped = mapCaptionsForShort(
      [
        { sourceStart: 99, duration: 1, text: "before" }, // drop
        { sourceStart: 105, duration: 2, text: "in" }, // → 5
        { sourceStart: 200, duration: 1, text: "after" }, // drop
      ],
      100,
      160,
    );
    expect(mapped).toEqual([{ outStart: 5, duration: 2, text: "in" }]);
  });

  it("clamps the duration so a caption never extends past the short", () => {
    const mapped = mapCaptionsForShort(
      [{ sourceStart: 155, duration: 10, text: "near the end" }],
      100,
      160,
    );
    // 155 → out 55; only 5 s left in the 60 s span → duration clamped to 5.
    expect(mapped[0]).toEqual({ outStart: 55, duration: 5, text: "near the end" });
  });

  it("includes a caption that STARTS before the short but ends inside it", () => {
    // Caption [98 → 103]; short [100, 160]. Intersection [100, 103] →
    // outStart 0, duration 3.
    const mapped = mapCaptionsForShort(
      [{ sourceStart: 98, duration: 5, text: "straddles in-point" }],
      100,
      160,
    );
    expect(mapped).toEqual([{ outStart: 0, duration: 3, text: "straddles in-point" }]);
  });

  it("drops zero-duration / non-overlapping / right-on-boundary captions", () => {
    const mapped = mapCaptionsForShort(
      [
        { sourceStart: 50, duration: 50, text: "ends exactly at in-point" }, // capEnd=100 → drop
        { sourceStart: 160, duration: 5, text: "starts exactly at out-point" }, // drop
        { sourceStart: 110, duration: 0, text: "zero duration" }, // drop
        { sourceStart: 105, duration: 3, text: "kept" },
      ],
      100,
      160,
    );
    expect(mapped).toEqual([{ outStart: 5, duration: 3, text: "kept" }]);
  });

  it("returns an empty array when no captions overlap the short", () => {
    const mapped = mapCaptionsForShort(
      [
        { sourceStart: 0, duration: 50, text: "way before" },
        { sourceStart: 300, duration: 5, text: "way after" },
      ],
      100,
      160,
    );
    expect(mapped).toEqual([]);
  });
});

describe("buildShortRenderArgs", () => {
  it("trims to in/out, crops to 9:16, scales to 1080x1920, and offsets overlays", () => {
    const args = buildShortRenderArgs({
      sourcePath: "src.mp4",
      inSeconds: 100,
      outSeconds: 160,
      overlays: [{ inputPath: "ov.webm", sourceStart: 105, duration: 2, placement: "center" }],
      outputPath: "short.mp4",
    });
    expect(args.slice(0, 6)).toEqual(["-ss", "100", "-to", "160", "-i", "src.mp4"]);
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("crop=w=ih*9/16:h=ih,scale=1080:1920");
    // overlay output time is relative to the short start: 105 - 100 = 5.
    expect(fc).toContain("enable='between(t,5,7)'");
    expect(args[args.indexOf("-map") + 1]).toBe("[outv]");
  });

  it("forces the libvpx-vp9 decoder before a WebM overlay (exposes VP9 alpha)", () => {
    const args = buildShortRenderArgs({
      sourcePath: "src.mp4",
      inSeconds: 100,
      outSeconds: 160,
      overlays: [{ inputPath: "ov.webm", sourceStart: 105, duration: 2, placement: "center" }],
      outputPath: "short.mp4",
    });
    const i = args.indexOf("ov.webm");
    expect(args.slice(i - 3, i + 1)).toEqual(["-c:v", "libvpx-vp9", "-i", "ov.webm"]);
  });
});

describe("boundaryEffect (SS-2)", () => {
  it("prefers the outgoing transition_out", () => {
    expect(boundaryEffect("punch_zoom", "cut")).toBe("punch_zoom");
    expect(boundaryEffect("smash_cut", "punch_zoom")).toBe("smash_cut");
  });
  it("falls back to the incoming transition_in when out is a plain cut/none", () => {
    expect(boundaryEffect("cut", "smash_cut")).toBe("smash_cut");
    expect(boundaryEffect("none", "punch_zoom")).toBe("punch_zoom");
  });
  it("returns 'cut' when neither side carries an effect", () => {
    expect(boundaryEffect("cut", "none")).toBe("cut");
    expect(boundaryEffect("", "")).toBe("cut");
  });
});

describe("buildShortsSegmentArgs (SS-2)", () => {
  // Four 5-second segments → offsets [0,5,10,15], total 20s.
  function fourSegments(): ShortsSegmentRenderPlan {
    const seg = (inS: number, tin = "cut", tout = "cut", overlays: never[] = []) => ({
      inSeconds: inS,
      outSeconds: inS + 5,
      transitionIn: tin,
      transitionOut: tout,
      overlays,
    });
    return {
      sourcePath: "src.mp4",
      segments: [seg(0), seg(10), seg(20), seg(30)],
      outputPath: "short_001.mp4",
    };
  }
  const fc = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

  it("trims, 9:16-crops, scales each segment and concats N=4", () => {
    const args = buildShortsSegmentArgs(fourSegments());
    expect(args.slice(0, 2)).toEqual(["-i", "src.mp4"]);
    const f = fc(args);
    // one trim + one atrim per segment
    expect((f.match(/\[0:v\]trim=start=/g) || []).length).toBe(4);
    expect((f.match(/\[0:a\]atrim=start=/g) || []).length).toBe(4);
    expect(f).toContain("crop=w=ih*9/16:h=ih,scale=1080:1920,setsar=1[sv0]");
    expect(f).toContain("[sv0][sa0][sv1][sa1][sv2][sa2][sv3][sa3]concat=n=4:v=1:a=1[cv][ca]");
    // With no overlays/transitions, video maps the concat label; audio maps [ca].
    const mapIdxs = args.map((a, k) => (a === "-map" ? k : -1)).filter((k) => k >= 0);
    expect(args[mapIdxs[0] + 1]).toBe("[cv]");
    expect(args[mapIdxs[1] + 1]).toBe("[ca]");
  });

  it("applies no transition filters when every boundary is a plain cut", () => {
    const f = fc(buildShortsSegmentArgs(fourSegments()));
    expect(f).not.toContain("drawbox");
    expect(f).not.toContain("split=2");
  });

  it("emits a white flash for smash_cut and a zoom for punch_zoom at the right output times", () => {
    const plan = fourSegments();
    plan.segments[0].transitionOut = "punch_zoom"; // boundary 0→1 at t=5 (zoom on outgoing tail)
    plan.segments[2].transitionIn = "smash_cut"; // boundary 1→2 at t=10 (flash as seg2 enters)
    const f = fc(buildShortsSegmentArgs(plan));
    // smash_cut flash starts at the boundary (offset of seg2 = 10), lasts 0.15s
    expect(f).toContain("drawbox");
    expect(f).toContain("between(t,10,10.15)");
    // punch_zoom zooms the outgoing tail: window [5-0.35, 5] = [4.65, 5]
    expect(f).toContain("split=2");
    expect(f).toContain("between(t,4.65,5)");
  });

  it("falls back to a plain cut for whip_pan (no transition filter emitted)", () => {
    const plan = fourSegments();
    plan.segments[1].transitionOut = "whip_pan";
    const f = fc(buildShortsSegmentArgs(plan));
    expect(f).not.toContain("drawbox");
    expect(f).not.toContain("split=2");
  });

  it("times a per-segment overlay relative to its segment's assembled position", () => {
    const plan = fourSegments();
    // overlay on segment index 2 (offset 10), appears 1s in, lasts 3s → [11,14]
    plan.segments[2].overlays = [
      { inputPath: "mg.webm", appearAtSeconds: 1, durationSeconds: 3 } as never,
    ];
    const args = buildShortsSegmentArgs(plan);
    const f = fc(args);
    expect(f).toContain("enable='between(t,11,14)'");
    // the webm overlay input is decoded with libvpx-vp9
    const i = args.indexOf("mg.webm");
    expect(args.slice(i - 3, i + 1)).toEqual(["-c:v", "libvpx-vp9", "-i", "mg.webm"]);
  });

  it("composites the hook at t=0 and the CTA over the final segment's tail", () => {
    const plan = fourSegments();
    plan.hookOverlay = { inputPath: "hook.webm", appearAtSeconds: 0, durationSeconds: 3 };
    plan.ctaOverlay = { inputPath: "cta.webm", appearAtSeconds: 0, durationSeconds: 2 };
    const args = buildShortsSegmentArgs(plan);
    const f = fc(args);
    expect(f).toContain("enable='between(t,0,3)'"); // hook at output 0
    expect(f).toContain("enable='between(t,18,20)'"); // cta over tail: total 20 - 2 = 18
    // input order: source, hook, cta → both decoded with libvpx-vp9
    expect(args.indexOf("hook.webm")).toBeLessThan(args.indexOf("cta.webm"));
  });
});

describe("buildShortsSegmentArgs SS-6 features", () => {
  const seg = (inS: number, extra: Partial<import("./renderExporter").ShortSegmentRenderInput> = {}) => ({
    inSeconds: inS,
    outSeconds: inS + 5,
    transitionIn: "cut",
    transitionOut: "cut",
    overlays: [],
    ...extra,
  });
  const basePlan = (extra: Partial<import("./renderExporter").ShortsSegmentRenderPlan> = {}) => ({
    sourcePath: "src.mp4",
    segments: [seg(0), seg(10), seg(20), seg(30)],
    outputPath: "out.mp4",
    ...extra,
  });
  const fc = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

  it("applies a Ken Burns 1.25x zoom to peak segments only", () => {
    const plan = basePlan();
    plan.segments[1] = seg(10, { energy: "peak" });
    const f = fc(buildShortsSegmentArgs(plan));
    expect(f).toContain("zoompan=z='min(1.0+0.25*on/");
    expect(f).toContain(",1.25)"); // max zoom
    // only one zoompan (the single peak segment)
    expect((f.match(/zoompan=/g) || []).length).toBe(1);
  });

  it("renders no zoompan when no segment is peak", () => {
    expect(fc(buildShortsSegmentArgs(basePlan()))).not.toContain("zoompan");
  });

  it("scales to the 720x1280 proxy frame in proxy mode", () => {
    const f = fc(buildShortsSegmentArgs(basePlan({ proxy: true })));
    expect(f).toContain("scale=720:1280");
    expect(f).not.toContain("scale=1080:1920");
  });

  it("adds fade-in at t=0 and fade-out ending just before the CTA", () => {
    const plan = basePlan({
      fadeInSeconds: 0.3,
      fadeOutSeconds: 0.5,
      ctaOverlay: { inputPath: "cta.webm", appearAtSeconds: 0, durationSeconds: 2 },
    });
    const f = fc(buildShortsSegmentArgs(plan));
    expect(f).toContain("fade=t=in:st=0:d=0.3");
    // total 20s, cta 2s → ctaStart 18, fade-out starts 18 - 0.5 = 17.5
    expect(f).toContain("fade=t=out:st=17.5:d=0.5");
  });

  it("adds a 1.04x zoom-punch at every plain-cut boundary when enabled", () => {
    const f = fc(buildShortsSegmentArgs(basePlan({ zoomPunchOnCut: true })));
    expect(f).toContain("scale=iw*1.04:ih*1.04,crop=iw/1.04:ih/1.04");
    // cut boundaries at 5, 10, 15
    expect(f).toContain("between(t,5,5.18)");
    expect(f).toContain("between(t,10,10.18)");
    expect(f).toContain("between(t,15,15.18)");
  });

  it("omits the cut zoom-punch when the flag is off", () => {
    expect(fc(buildShortsSegmentArgs(basePlan()))).not.toContain("scale=iw*1.04");
  });
});

describe("buildShortStillsArgs + xstackLayout (SS-6 contact sheet)", () => {
  it("extracts one midpoint still per segment and tiles them", () => {
    const args = buildShortStillsArgs({
      sourcePath: "src.mp4",
      segments: [
        { inSeconds: 0, outSeconds: 6 }, // midpoint 3
        { inSeconds: 10, outSeconds: 16 }, // midpoint 13
      ],
      outputPath: "sheet.png",
    });
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toContain("trim=start=3:");
    expect(f).toContain("trim=start=13:");
    expect(f).toContain("crop=w=ih*9/16:h=ih");
    expect(f).toContain("xstack=inputs=2");
    expect(args.slice(-4)).toEqual(["-frames:v", "1", "-y", "sheet.png"]);
  });

  it("lays tiles into a cols-wide grid", () => {
    expect(xstackLayout(4, 3)).toBe("0_0|w0_0|w0+w1_0|0_h0");
    expect(xstackLayout(2, 3)).toBe("0_0|w0_0");
  });
});
