import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_VERSION,
  deserializeProject,
  serializeProject,
} from "./projectSnapshot";
import { EditListSchema } from "./editListParser";
import { buildTimeline } from "./timelineBuilder";
import sweetRelief from "./__fixtures__/sweet-relief.json";

const editList = EditListSchema.parse(sweetRelief);
const { events, keepSegments } = buildTimeline(editList);

const base = {
  projectName: "Sweet Relief",
  durationSeconds: 2528.021,
  sourceVideoPath: "/projects/sweet-relief/source/rec.mp4",
  approved: true,
  events,
  keepSegments,
  playerDisplayNames: { matis_tel: "Mathis Tel" },
};

describe("project snapshot", () => {
  it("round-trips a serialized project through validation", () => {
    const snapshot = serializeProject(base);
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(snapshot.events.length).toBe(events.length);

    const result = deserializeProject(JSON.parse(JSON.stringify(snapshot)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.projectName).toBe("Sweet Relief");
    expect(result.snapshot.approved).toBe(true);
    expect(result.snapshot.playerDisplayNames).toEqual({ matis_tel: "Mathis Tel" });
    // Nested event data (cutData / motionGraphicData) survives the round-trip.
    const mg = result.snapshot.events.find((e) => e.kind === "motion_graphic");
    expect((mg as Record<string, unknown>)?.motionGraphicData).toBeDefined();
  });

  it("rejects a malformed snapshot with field-level errors", () => {
    const result = deserializeProject({ projectName: "x" }); // missing required fields
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("refuses a snapshot from a newer version", () => {
    const snapshot = { ...serializeProject(base), version: SNAPSHOT_VERSION + 1 };
    const result = deserializeProject(snapshot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/newer version/);
  });
});
