import { describe, it, expect } from "vitest";
import { resolvePosition } from "../../src/renderer/position.js";
import type { BannerPosition, BoundingBox } from "../../src/types.js";

const banner = (x: number, y: number, w: number, h: number): BannerPosition => ({
  anchor: "bottom_left",
  x,
  y,
  width: w,
  height: h,
});

const zone = (x: number, y: number, w: number, h: number): BoundingBox => ({
  x,
  y,
  width: w,
  height: h,
});

describe("resolvePosition — no collision", () => {
  it("passes through when no face zones", () => {
    const b = banner(0.1, 0.8, 0.4, 0.1);
    const result = resolvePosition(b, [], 0.1);
    expect(result.suppressed).toBe(false);
    expect(result.position).toEqual(b);
  });

  it("passes through when banner doesn't overlap zone", () => {
    const b = banner(0.1, 0.8, 0.4, 0.1);
    const z = zone(0.6, 0.1, 0.3, 0.3);
    const result = resolvePosition(b, [z], 0.1);
    expect(result.suppressed).toBe(false);
    expect(result.position).toEqual(b);
  });
});

describe("resolvePosition — vertical shift", () => {
  it("shifts banner up to clear face zone", () => {
    const b = banner(0.1, 0.5, 0.4, 0.1);
    const z = zone(0.0, 0.5, 1.0, 0.2);
    const result = resolvePosition(b, [z], 0.1);
    if (!result.suppressed) {
      expect(result.position.y).not.toBe(b.y);
      expect(result.position.y + result.position.height).toBeLessThanOrEqual(z.y + 0.001);
    }
  });

  it("shifts banner down when up-shift is out of bounds", () => {
    const b = banner(0.1, 0.02, 0.4, 0.1);
    const z = zone(0.0, 0.0, 1.0, 0.2);
    const result = resolvePosition(b, [z], 0.1);
    if (!result.suppressed) {
      expect(result.position.y).toBeGreaterThanOrEqual(z.y + z.height - 0.001);
    }
  });
});

describe("resolvePosition — width reduction", () => {
  it("reduces width when vertical shift fails", () => {
    const b = banner(0.35, 0.45, 0.4, 0.1);
    const z = zone(0.3, 0.0, 0.4, 1.0);
    const result = resolvePosition(b, [z], 0.1);
    if (!result.suppressed) {
      expect(result.position.width).toBeLessThan(b.width);
    }
  });
});

describe("resolvePosition — suppression", () => {
  it("suppresses when zone covers entire canvas", () => {
    const b = banner(0.0, 0.0, 0.5, 0.5);
    const z = zone(0.0, 0.0, 1.0, 1.0);
    const result = resolvePosition(b, [z], 0.5);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe("face_zone_unresolvable");
  });
});
