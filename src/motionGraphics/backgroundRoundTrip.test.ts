/*
 * Save-and-reopen round-trip for the per-MG background image fields.
 *
 * The fields (background_image_id, background_image_opacity, background_image_fit)
 * live inside MotionGraphicData.params, which is a Record<string, unknown> and
 * rides through ProjectSnapshotSchema's `passthrough()` event shape. This test
 * pins that behaviour so a future schema tightening doesn't silently drop them.
 */

import { describe, expect, it } from "vitest";
import {
  deserializeProject,
  serializeProject,
  type SerializableProject,
} from "../project/projectSnapshot";
import type { TimelineEvent } from "../project/types";

function mgEvent(params: Record<string, unknown>): TimelineEvent {
  return {
    id: "mg-1",
    kind: "motion_graphic",
    label: "Quote",
    start: 10,
    duration: 4,
    track: 2,
    enabled: true,
    locked: false,
    reviewRequired: false,
    confidence: 1,
    motionGraphicData: {
      templateId: "quote_card",
      params,
      buildStatus: "ready",
      mgId: "mg-1",
    },
    overlayData: {
      assetPath: "",
      assetId: "mg-1",
      placement: "center",
      x: 0,
      y: 0,
      width: 1,
      opacity: 1,
    },
  };
}

function project(events: TimelineEvent[]): SerializableProject {
  return {
    projectName: "round-trip",
    durationSeconds: 30,
    sourceVideoPath: "C:/fake/source.mp4",
    approved: false,
    events,
    keepSegments: [{ start: 0, end: 30 }],
    playerDisplayNames: {},
  };
}

describe("MG background fields round-trip through save → reopen", () => {
  it("preserves all three fields when round-tripping a quote_card", () => {
    const ev = mgEvent({
      text: "We need a striker.",
      attribution: "Stuart",
      background_image_id: "abcd-1234",
      background_image_opacity: 42,
      background_image_fit: "contain",
    });
    const raw = JSON.parse(JSON.stringify(serializeProject(project([ev]))));
    const parsed = deserializeProject(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = parsed.snapshot.events[0];
    const params = (restored as unknown as TimelineEvent).motionGraphicData!.params;
    expect(params.background_image_id).toBe("abcd-1234");
    expect(params.background_image_opacity).toBe(42);
    expect(params.background_image_fit).toBe("contain");
  });

  it("preserves opacity=0 (per spec: opacity 0 still runs the filter)", () => {
    const ev = mgEvent({
      text: "Hi",
      background_image_id: "id1",
      background_image_opacity: 0,
      background_image_fit: "cover",
    });
    const raw = JSON.parse(JSON.stringify(serializeProject(project([ev]))));
    const parsed = deserializeProject(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const params = (parsed.snapshot.events[0] as unknown as TimelineEvent).motionGraphicData!.params;
    expect(params.background_image_opacity).toBe(0);
  });

  it("survives without any bg fields (back-compat with older projects)", () => {
    const ev = mgEvent({ text: "No bg here" });
    const raw = JSON.parse(JSON.stringify(serializeProject(project([ev]))));
    const parsed = deserializeProject(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const params = (parsed.snapshot.events[0] as unknown as TimelineEvent).motionGraphicData!.params;
    expect("background_image_id" in params).toBe(false);
  });
});
