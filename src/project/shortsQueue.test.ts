import { describe, expect, it } from "vitest";
import { listShorts, overlaysWithinSpan } from "./shortsQueue";
import type { TimelineEvent } from "./types";

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
