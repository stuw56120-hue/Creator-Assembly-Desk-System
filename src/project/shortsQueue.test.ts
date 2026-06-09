import { describe, expect, it } from "vitest";
import {
  captionWordsFromEvents,
  listShorts,
  mgPathById,
  overlaysWithinSpan,
  shortV2RenderPlan,
} from "./shortsQueue";
import type { ShortData, TimelineEvent } from "./types";

function ev(partial: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "kind" | "start">): TimelineEvent {
  return {
    label: partial.id,
    duration: 2,
    track: 0,
    enabled: true,
    locked: false,
    reviewRequired: false,
    confidence: 1,
    ...partial,
  } as TimelineEvent;
}

const events: TimelineEvent[] = [
  ev({ id: "short_b", kind: "short_in", start: 50, duration: 30 }),
  ev({ id: "short_a", kind: "short_in", start: 10, duration: 20 }),
  ev({
    id: "mg_inside",
    kind: "motion_graphic",
    start: 12,
    overlayData: { assetPath: "/lib/mg.webm", assetId: "mg", placement: "center", x: 0.5, y: 0.5, width: 0.4, opacity: 1 },
  }),
  ev({
    id: "mg_outside",
    kind: "motion_graphic",
    start: 40,
    overlayData: { assetPath: "/lib/mg2.webm", assetId: "mg2", placement: "center", x: 0.5, y: 0.5, width: 0.4, opacity: 1 },
  }),
  ev({
    id: "mg_unbuilt",
    kind: "motion_graphic",
    start: 13,
    overlayData: { assetPath: "", assetId: "mg3", placement: "center", x: 0.5, y: 0.5, width: 0.4, opacity: 1 },
  }),
];

describe("listShorts", () => {
  it("returns short clips in chronological order", () => {
    expect(listShorts(events).map((s) => s.id)).toEqual(["short_a", "short_b"]);
  });
});

describe("overlaysWithinSpan", () => {
  it("includes built overlays inside the span and excludes the rest", () => {
    const overlays = overlaysWithinSpan(events, 10, 30); // short_a span
    expect(overlays.map((o) => o.inputPath)).toEqual(["/lib/mg.webm"]);
    // mg_outside (start 40) and mg_unbuilt (empty assetPath) are excluded.
  });

  it("excludes disabled overlays", () => {
    const withDisabled = events.map((e) =>
      e.id === "mg_inside" ? { ...e, enabled: false } : e,
    );
    expect(overlaysWithinSpan(withDisabled, 10, 30)).toHaveLength(0);
  });
});

describe("captionWordsFromEvents (SS-6 v2 caption words)", () => {
  it("even-splits each caption line into word-level timings", () => {
    const evs: TimelineEvent[] = [
      ev({ id: "c1", kind: "caption", start: 10, duration: 2, captionData: { speaker: "", text: "one two" } }),
      ev({ id: "c2", kind: "caption", start: 20, duration: 1, captionData: { speaker: "", text: "  " } }), // blank → skipped
      ev({ id: "c3", kind: "caption", start: 30, duration: 3, captionData: { speaker: "", text: "a b c" }, enabled: false }), // disabled → skipped
    ];
    const words = captionWordsFromEvents(evs);
    expect(words.map((w) => w.text)).toEqual(["one", "two"]);
    expect(words[0]).toEqual({ text: "one", start: 10, end: 11 });
    expect(words[1]).toEqual({ text: "two", start: 11, end: 12 });
  });
});

describe("mgPathById + shortV2RenderPlan (SS-6)", () => {
  const mgEvents: TimelineEvent[] = [
    ev({
      id: "mg_quote",
      kind: "motion_graphic",
      start: 12,
      overlayData: { assetPath: "/lib/quote.webm", assetId: "a1", placement: "center", x: 0.5, y: 0.5, width: 0.4, opacity: 1 },
      motionGraphicData: { templateId: "quote_card", params: {}, buildStatus: "ready", mgId: "mg_quote" },
    }),
    ev({
      id: "mg_unbuilt",
      kind: "motion_graphic",
      start: 13,
      overlayData: { assetPath: "", assetId: "a2", placement: "center", x: 0.5, y: 0.5, width: 0.4, opacity: 1 },
      motionGraphicData: { templateId: "subscribe_flash", params: {}, buildStatus: "pending", mgId: "mg_sub" },
    }),
    ev({ id: "cap", kind: "caption", start: 35, duration: 2, captionData: { speaker: "", text: "spurs survive" } }),
  ];

  it("maps only built motion graphics by template id and instance id", () => {
    const map = mgPathById(mgEvents);
    expect(map.get("quote_card")).toBe("/lib/quote.webm");
    expect(map.get("mg_quote")).toBe("/lib/quote.webm");
    expect(map.has("subscribe_flash")).toBe(false); // unbuilt → omitted
  });

  it("resolves segment overlays to built assets and drops unresolved ones", () => {
    const shortData: ShortData = {
      shortId: "s1",
      hook: "Hook",
      captionStyle: "shorts_bold",
      aspectRatio: "9:16",
      notes: [],
      segments: [
        {
          segmentId: "seg1",
          inSeconds: 35,
          outSeconds: 40,
          energy: "peak",
          transitionIn: "none",
          transitionOut: "cut",
          overlays: [
            { motionGraphicId: "quote_card", appearAtSeconds: 1, durationSeconds: 3 }, // resolves
            { motionGraphicId: "subscribe_flash", appearAtSeconds: 0, durationSeconds: 2 }, // unbuilt → dropped
          ],
          captionEmphasis: ["survive"],
        },
      ],
    };
    const plan = shortV2RenderPlan({
      shortData,
      events: mgEvents,
      sourcePath: "/src.mp4",
      captionStyle: "shorts_bold",
      quality: "proxy",
      defaultName: "x-short-001.mp4",
    });
    expect(plan.quality).toBe("proxy");
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].energy).toBe("peak");
    expect(plan.segments[0].emphasis).toEqual(["survive"]);
    expect(plan.segments[0].overlays).toEqual([{ inputPath: "/lib/quote.webm", appearAtSeconds: 1, durationSeconds: 3 }]);
    expect(plan.captionWords.map((w) => w.text)).toEqual(["spurs", "survive"]);
  });
});
