import { describe, expect, it } from "vitest";
import { applyDisplayNameToEvents, humanizeSubject, replacePlayerReference } from "./displayNames";
import type { TimelineEvent } from "./types";

function ev(partial: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "kind">): TimelineEvent {
  return {
    label: "",
    start: 0,
    duration: 1,
    track: 0,
    enabled: true,
    locked: false,
    reviewRequired: false,
    confidence: 1,
    ...partial,
  } as TimelineEvent;
}

describe("humanizeSubject", () => {
  it("title-cases a slug", () => {
    expect(humanizeSubject("matis_tel")).toBe("Matis Tel");
    expect(humanizeSubject("micky-van-de-ven")).toBe("Micky Van De Ven");
  });
});

describe("replacePlayerReference", () => {
  it("matches slug, hyphen, and spaced forms (case-insensitive, whole word)", () => {
    expect(replacePlayerReference("Goal from matis_tel!", "matis_tel", "Mathis Tel")).toBe(
      "Goal from Mathis Tel!",
    );
    expect(replacePlayerReference("matis-tel scores", "matis_tel", "Mathis Tel")).toBe(
      "Mathis Tel scores",
    );
    expect(replacePlayerReference("Matis Tel with the assist", "Matis Tel", "Mathis Tel")).toBe(
      "Mathis Tel with the assist",
    );
  });

  it("does not replace partial-word matches", () => {
    expect(replacePlayerReference("telephone", "tel", "X")).toBe("telephone");
  });
});

describe("applyDisplayNameToEvents", () => {
  const events: TimelineEvent[] = [
    ev({ id: "ch1", kind: "chapter", label: "matis_tel's masterclass" }),
    ev({
      id: "mg1",
      kind: "motion_graphic",
      label: "matis_tel",
      motionGraphicData: { templateId: "topic_banner", buildStatus: "pending", mgId: "mg1", params: { title: "matis_tel", duration: 3 } },
    }),
    ev({ id: "cap1", kind: "caption", label: "Matis Tel scored", captionData: { speaker: "", text: "Matis Tel scored" } }),
    ev({ id: "cut1", kind: "cut", label: "Trim · 1.5s" }), // unaffected
  ];

  it("rewrites the player reference in labels, MG params, and captions", () => {
    const out = applyDisplayNameToEvents(events, "matis_tel", "Mathis Tel");
    expect(out[0].label).toBe("Mathis Tel's masterclass");
    expect(out[1].motionGraphicData?.params.title).toBe("Mathis Tel");
    expect(out[1].motionGraphicData?.params.duration).toBe(3); // non-string untouched
    expect(out[2].captionData?.text).toBe("Mathis Tel scored");
    expect(out[3].label).toBe("Trim · 1.5s"); // cut unaffected
  });

  it("is a no-op when from === to", () => {
    const out = applyDisplayNameToEvents(events, "Mathis Tel", "Mathis Tel");
    expect(out).toBe(events);
  });
});
