/*
 * Tests for the pure helpers in backgroundAssets.ts. These cover the
 * validation rules listed in the spec's "Edge cases" section:
 *   • Unsupported format rejected
 *   • > 10 MB rejected
 *   • Opacity clamped to 0–100 (defaults to 30 when missing/NaN)
 *   • Index round-trip (read/write/append)
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_BG_EXTENSIONS,
  DEFAULT_BG_FIT,
  DEFAULT_BG_OPACITY,
  MAX_BG_BYTES,
  appendBackgroundEntry,
  clampBackgroundOpacity,
  parseBackgroundIndex,
  uuidV4,
  validateBackgroundUpload,
} from "./backgroundAssets";

describe("validateBackgroundUpload", () => {
  it("accepts each allow-listed extension at any size up to the cap", () => {
    for (const ext of ALLOWED_BG_EXTENSIONS) {
      expect(validateBackgroundUpload(`file${ext}`, 1024)).toEqual({ ok: true, ext });
    }
  });

  it("accepts uppercase extensions (case-insensitive match)", () => {
    expect(validateBackgroundUpload("PHOTO.JPG", 10)).toEqual({ ok: true, ext: ".jpg" });
    expect(validateBackgroundUpload("photo.WebP", 10)).toEqual({ ok: true, ext: ".webp" });
  });

  it("rejects unsupported extensions with a plain-English message", () => {
    const r = validateBackgroundUpload("animation.gif", 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JPG, PNG, or WebP/);
  });

  it("rejects files with no extension", () => {
    const r = validateBackgroundUpload("README", 100);
    expect(r.ok).toBe(false);
  });

  it("rejects files larger than 10 MB", () => {
    const r = validateBackgroundUpload("photo.jpg", MAX_BG_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Max 10 MB/);
  });

  it("accepts a file exactly at the 10 MB cap", () => {
    expect(validateBackgroundUpload("photo.jpg", MAX_BG_BYTES)).toEqual({ ok: true, ext: ".jpg" });
  });
});

describe("uuidV4", () => {
  it("produces a syntactically valid RFC 4122 v4 UUID", () => {
    const id = uuidV4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("does not collide across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(uuidV4());
    expect(set.size).toBe(200);
  });
});

describe("clampBackgroundOpacity", () => {
  it("defaults to DEFAULT_BG_OPACITY for non-numeric input", () => {
    expect(clampBackgroundOpacity(undefined)).toBe(DEFAULT_BG_OPACITY);
    expect(clampBackgroundOpacity(Number.NaN)).toBe(DEFAULT_BG_OPACITY);
  });

  it("clamps to 0..100 and rounds to an integer", () => {
    expect(clampBackgroundOpacity(-5)).toBe(0);
    expect(clampBackgroundOpacity(150)).toBe(100);
    expect(clampBackgroundOpacity(33.7)).toBe(34);
    expect(clampBackgroundOpacity(0)).toBe(0);
    expect(clampBackgroundOpacity(100)).toBe(100);
  });
});

describe("background index file", () => {
  it("appends entries in insertion order without dedup", () => {
    const a = appendBackgroundEntry(null, {
      id: "a",
      original_filename: "a.jpg",
      ext: ".jpg",
      bytes: 1,
      created_at: "2026-01-01T00:00:00Z",
    });
    const b = appendBackgroundEntry(a, {
      id: "a", // intentionally same id — spec says no dedup
      original_filename: "a.jpg",
      ext: ".jpg",
      bytes: 1,
      created_at: "2026-01-01T00:00:01Z",
    });
    expect(b.entries.length).toBe(2);
  });

  it("parses a well-formed index", () => {
    const raw = JSON.stringify({
      entries: [
        { id: "1", original_filename: "x.png", ext: ".png", bytes: 100, created_at: "t" },
      ],
    });
    expect(parseBackgroundIndex(raw).entries.length).toBe(1);
  });

  it("returns empty for null / malformed JSON / missing entries", () => {
    expect(parseBackgroundIndex(null).entries).toEqual([]);
    expect(parseBackgroundIndex("not json").entries).toEqual([]);
    expect(parseBackgroundIndex("{}").entries).toEqual([]);
    expect(parseBackgroundIndex('{"entries":"oops"}').entries).toEqual([]);
  });

  it("filters out entries missing required fields", () => {
    const raw = JSON.stringify({
      entries: [
        { id: "1", original_filename: "x.png", ext: ".png", bytes: 100, created_at: "t" },
        { id: 5, ext: ".png" }, // bad id type
        { ext: ".png" }, // no id
      ],
    });
    expect(parseBackgroundIndex(raw).entries.length).toBe(1);
  });
});

it("DEFAULT_BG_FIT is 'cover' (spec)", () => {
  expect(DEFAULT_BG_FIT).toBe("cover");
});

it("DEFAULT_BG_OPACITY is 30 (spec)", () => {
  expect(DEFAULT_BG_OPACITY).toBe(30);
});
