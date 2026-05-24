import { describe, it, expect } from "vitest";
import { resolveStartOffset } from "../../src/renderer/timing.js";

describe("resolveStartOffset", () => {
  it("applies negative offset when no previous banner", () => {
    const offset = resolveStartOffset(10000, -250, null);
    expect(offset).toBe(-250);
  });

  it("applies negative offset when safe (no overlap)", () => {
    const offset = resolveStartOffset(10000, -250, 9000);
    expect(offset).toBe(-250);
  });

  it("clamps offset to 0 when proposed start overlaps previous banner exit", () => {
    const offset = resolveStartOffset(10000, -250, 10500);
    expect(offset).toBe(0);
  });

  it("clamps to 0 when offset would start exactly at previous exit end", () => {
    const offset = resolveStartOffset(10000, -250, 9750);
    expect(offset).toBe(-250);
  });

  it("clamps to 0 when previous banner just finished and offset would overlap", () => {
    const offset = resolveStartOffset(5000, -500, 4800);
    expect(offset).toBe(0);
  });

  it("allows negative offset when previous banner ended long ago", () => {
    const offset = resolveStartOffset(20000, -250, 5000);
    expect(offset).toBe(-250);
  });

  it("uses 0 as default offset when passed", () => {
    const offset = resolveStartOffset(10000, 0, null);
    expect(offset).toBe(0);
  });

  it("handles positive offset correctly with no previous banner", () => {
    const offset = resolveStartOffset(10000, 100, null);
    expect(offset).toBe(100);
  });
});
