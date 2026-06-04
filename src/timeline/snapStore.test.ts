import { describe, expect, it } from "vitest";
import { collectSnapPoints, snapValue } from "./snapStore";

describe("snapValue", () => {
  const points = [0, 10, 25.5];
  it("snaps to the nearest point within the threshold", () => {
    expect(snapValue(9.9, points, 0.5)).toBe(10);
    expect(snapValue(25.7, points, 0.5)).toBe(25.5);
  });
  it("leaves the value unchanged when nothing is close enough", () => {
    expect(snapValue(12, points, 0.5)).toBe(12);
  });
  it("picks the closest of several candidates", () => {
    expect(snapValue(10.2, [10, 10.3], 1)).toBe(10.3);
  });
});

describe("collectSnapPoints", () => {
  const events = [
    { id: "a", start: 5, duration: 3 }, // edges 5, 8
    { id: "b", start: 20, duration: 2 }, // edges 20, 22
  ];
  it("includes the playhead and every other clip's start/end, excluding self", () => {
    const pts = collectSnapPoints(events, "a", 12);
    expect(pts).toContain(12); // playhead
    expect(pts).toContain(20);
    expect(pts).toContain(22);
    expect(pts).not.toContain(5); // self excluded
    expect(pts).not.toContain(8);
  });
});
