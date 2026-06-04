/*
 * Tests for the ported HyperFrames timeline layout module (Apache License 2.0).
 * The upstream repo ships no timelineLayout.test.ts, so this suite is authored
 * for C.A.D.S. to cover tick generation, label formatting, zoom-anchor math,
 * playhead/canvas geometry, and asset-drop Y→track mapping (per spec).
 *
 * Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from "vitest";
import {
  GUTTER,
  RULER_H,
  TRACK_H,
  generateTicks,
  formatTimelineTickLabel,
  shouldAutoScrollTimeline,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  getTimelinePlayheadLeft,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
  shouldHandleTimelineDeleteKey,
  getDefaultDroppedTrack,
  resolveTimelineAssetDrop,
} from "./layout";

describe("generateTicks", () => {
  it("returns no ticks for non-positive or absurd durations", () => {
    expect(generateTicks(0)).toEqual({ major: [], minor: [] });
    expect(generateTicks(-5)).toEqual({ major: [], minor: [] });
    expect(generateTicks(Number.NaN)).toEqual({ major: [], minor: [] });
    expect(generateTicks(8000)).toEqual({ major: [], minor: [] }); // > 7200
  });

  it("derives major ticks from duration when no zoom is supplied", () => {
    // duration/6 = 10 → major interval 10; minor interval 2.
    const { major, minor } = generateTicks(60);
    expect(major).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(minor).toContain(2);
    expect(minor).not.toContain(10);
  });

  it("uses a finer major interval when zoomed in (pixelsPerSecond high)", () => {
    // At 100 px/s, the first interval whose px width >= 128 is 2s.
    const { major, minor } = generateTicks(60, 100);
    expect(major[0]).toBe(0);
    expect(major[1]).toBe(2);
    expect(major).toContain(4);
    expect(minor).toContain(0.5);
    expect(minor).toContain(1);
  });
});

describe("formatTimelineTickLabel", () => {
  it("renders sub-second labels with a tenths suffix below 1s major intervals", () => {
    expect(formatTimelineTickLabel(2.3, 10, 0.5)).toBe("0:02.3");
  });

  it("renders mm:ss labels under an hour", () => {
    expect(formatTimelineTickLabel(65, 120, 10)).toBe("1:05");
  });

  it("renders hh:mm:ss labels at or beyond an hour", () => {
    expect(formatTimelineTickLabel(3661, 3600, 60)).toBe("1:01:01");
  });

  it("guards non-finite input", () => {
    expect(formatTimelineTickLabel(Number.NaN, 60, 10)).toBe("0:00");
  });
});

describe("shouldAutoScrollTimeline", () => {
  it("never auto-scrolls in fit mode", () => {
    expect(shouldAutoScrollTimeline("fit", 1000, 100)).toBe(false);
  });

  it("auto-scrolls in manual mode when content overflows the viewport", () => {
    expect(shouldAutoScrollTimeline("manual", 200, 100)).toBe(true);
  });

  it("does not auto-scroll when content fits", () => {
    expect(shouldAutoScrollTimeline("manual", 100, 100)).toBe(false);
  });

  it("guards non-finite measurements", () => {
    expect(shouldAutoScrollTimeline("manual", Number.NaN, 100)).toBe(false);
  });
});

describe("getTimelineScrollLeftForZoomTransition", () => {
  it("resets scroll to zero when leaving manual zoom for fit", () => {
    expect(getTimelineScrollLeftForZoomTransition("manual", "fit", 500)).toBe(0);
  });

  it("preserves scroll for other transitions", () => {
    expect(getTimelineScrollLeftForZoomTransition("fit", "manual", 500)).toBe(500);
    expect(getTimelineScrollLeftForZoomTransition(null, "fit", 300)).toBe(300);
  });
});

describe("getTimelineScrollLeftForZoomAnchor", () => {
  it("keeps the time under the pointer fixed across a zoom change", () => {
    // pointer at x=200, gutter 32 → timelineX 168 → time 1.68s at 100px/s.
    // At 200px/s: gutter + 1.68*200 - 200 = 32 + 336 - 200 = 168.
    expect(
      getTimelineScrollLeftForZoomAnchor({
        pointerX: 200,
        currentScrollLeft: 0,
        gutter: 32,
        currentPixelsPerSecond: 100,
        nextPixelsPerSecond: 200,
        duration: 60,
      }),
    ).toBe(168);
  });

  it("falls back to the current scroll when inputs are invalid", () => {
    expect(
      getTimelineScrollLeftForZoomAnchor({
        pointerX: 200,
        currentScrollLeft: 50,
        gutter: 32,
        currentPixelsPerSecond: 100,
        nextPixelsPerSecond: 200,
        duration: 0,
      }),
    ).toBe(50);
  });
});

describe("getTimelinePlayheadLeft", () => {
  it("offsets the playhead by the gutter plus time × pps", () => {
    expect(getTimelinePlayheadLeft(5, 100)).toBe(GUTTER + 500);
  });

  it("clamps negative time to the gutter", () => {
    expect(getTimelinePlayheadLeft(-3, 100)).toBe(GUTTER);
  });

  it("returns the gutter for non-finite input", () => {
    expect(getTimelinePlayheadLeft(Number.NaN, 100)).toBe(GUTTER);
  });
});

describe("getTimelineCanvasHeight", () => {
  it("sums ruler, tracks, and scroll buffer", () => {
    expect(getTimelineCanvasHeight(5)).toBe(RULER_H + 5 * TRACK_H + 20);
  });

  it("treats negative track counts as zero", () => {
    expect(getTimelineCanvasHeight(-2)).toBe(RULER_H + 20);
  });
});

describe("shouldShowTimelineShortcutHint", () => {
  it("shows the hint when content is not scrollable", () => {
    expect(shouldShowTimelineShortcutHint(100, 100)).toBe(true);
  });

  it("hides the hint when content overflows", () => {
    expect(shouldShowTimelineShortcutHint(200, 100)).toBe(false);
  });

  it("shows the hint when measurements are unavailable", () => {
    expect(shouldShowTimelineShortcutHint(Number.NaN, 100)).toBe(true);
  });
});

describe("shouldHandleTimelineDeleteKey", () => {
  it("handles Delete/Backspace with no modifiers and no editable target", () => {
    expect(shouldHandleTimelineDeleteKey({ key: "Delete", target: null })).toBe(true);
    expect(shouldHandleTimelineDeleteKey({ key: "Backspace", target: null })).toBe(true);
  });

  it("ignores other keys", () => {
    expect(shouldHandleTimelineDeleteKey({ key: "a", target: null })).toBe(false);
  });

  it("ignores Delete when a modifier is held", () => {
    expect(shouldHandleTimelineDeleteKey({ key: "Delete", metaKey: true, target: null })).toBe(
      false,
    );
  });

  it("ignores Delete while typing in form fields or contenteditable", () => {
    const inputTarget = { tagName: "INPUT" } as unknown as EventTarget;
    const editableTarget = { isContentEditable: true } as unknown as EventTarget;
    expect(shouldHandleTimelineDeleteKey({ key: "Delete", target: inputTarget })).toBe(false);
    expect(shouldHandleTimelineDeleteKey({ key: "Backspace", target: editableTarget })).toBe(false);
  });
});

describe("getDefaultDroppedTrack", () => {
  it("returns 0 for an empty track order", () => {
    expect(getDefaultDroppedTrack([], 2)).toBe(0);
  });

  it("returns the first track when no/negative row index is given", () => {
    expect(getDefaultDroppedTrack([0, 1, 2])).toBe(0);
    expect(getDefaultDroppedTrack([0, 1, 2], -1)).toBe(0);
  });

  it("creates a new track below when the row index is past the last track", () => {
    expect(getDefaultDroppedTrack([0, 1, 2], 5)).toBe(3);
    expect(getDefaultDroppedTrack([0, 5, 9], 5)).toBe(10);
  });

  it("maps an in-range row index to its track id", () => {
    expect(getDefaultDroppedTrack([0, 5, 9], 1)).toBe(5);
  });
});

describe("resolveTimelineAssetDrop (Y → track mapping)", () => {
  const base = {
    rectLeft: 0,
    rectTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    pixelsPerSecond: 100,
    duration: 60,
    trackHeight: 72,
    trackOrder: [0, 1, 2],
  };

  it("maps a drop in the first track row to track 0 and the correct start", () => {
    // x = 132 - GUTTER(32) = 100 → 1.0s ; y = 24 - RULER_H(24) = 0 → row 0.
    expect(resolveTimelineAssetDrop(base, 132, 24)).toEqual({ start: 1, track: 0 });
  });

  it("maps a drop in the second track row to track 1", () => {
    // y = 101 - 24 = 77 → floor(77/72) = row 1 ; x = 232-32 = 200 → 2.0s.
    expect(resolveTimelineAssetDrop(base, 232, 101)).toEqual({ start: 2, track: 1 });
  });

  it("creates a new bottom track when dropped below the last row", () => {
    // y = 250 - 24 = 226 → floor(226/72) = 3 → past last → max+1 = 3.
    expect(resolveTimelineAssetDrop(base, 132, 250).track).toBe(3);
  });

  it("clamps the start to zero when dropped left of the content area", () => {
    expect(resolveTimelineAssetDrop(base, 0, 24).start).toBe(0);
  });

  it("clamps the start to the timeline duration when dropped far right", () => {
    expect(resolveTimelineAssetDrop(base, 7032, 24).start).toBe(60);
  });

  it("accounts for scroll offset and rect origin when computing start", () => {
    // x = 100 - rectLeft(10) + scrollLeft(50) - GUTTER(32) = 108 → 1.08s.
    expect(
      resolveTimelineAssetDrop({ ...base, rectLeft: 10, scrollLeft: 50 }, 100, 24).start,
    ).toBe(1.08);
  });
});
