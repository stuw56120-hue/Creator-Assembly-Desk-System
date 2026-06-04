/*
 * Tests for the Save shortcut helpers (matcher + dispatch).
 *
 * The actual keydown listener lives in useKeyboard, but the matcher logic
 * and the window-event dispatch surface are pinned here without needing a
 * React renderer.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAVE_REQUEST_EVENT, dispatchSaveRequest, matchesSaveShortcut } from "./saveShortcut";

function ev(
  partial: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>,
) {
  return {
    key: partial.key ?? "",
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    altKey: partial.altKey ?? false,
  };
}

describe("matchesSaveShortcut", () => {
  it("matches Ctrl+S (Windows/Linux)", () => {
    expect(matchesSaveShortcut(ev({ key: "s", ctrlKey: true }))).toBe(true);
    expect(matchesSaveShortcut(ev({ key: "S", ctrlKey: true }))).toBe(true); // case-insensitive
  });

  it("matches Cmd+S (macOS)", () => {
    expect(matchesSaveShortcut(ev({ key: "s", metaKey: true }))).toBe(true);
  });

  it("rejects plain 's' (no modifier)", () => {
    expect(matchesSaveShortcut(ev({ key: "s" }))).toBe(false);
  });

  it("rejects Alt+S (reserved for future use)", () => {
    expect(matchesSaveShortcut(ev({ key: "s", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("rejects modifier-only events", () => {
    expect(matchesSaveShortcut(ev({ key: "Control", ctrlKey: true }))).toBe(false);
    expect(matchesSaveShortcut(ev({ key: "Meta", metaKey: true }))).toBe(false);
  });

  it("rejects other modifier-letter combinations", () => {
    expect(matchesSaveShortcut(ev({ key: "z", ctrlKey: true }))).toBe(false);
    expect(matchesSaveShortcut(ev({ key: "a", ctrlKey: true }))).toBe(false);
  });
});

describe("dispatchSaveRequest", () => {
  let received = 0;
  const listener = () => {
    received++;
  };

  beforeEach(() => {
    received = 0;
    if (typeof window !== "undefined") {
      window.addEventListener(SAVE_REQUEST_EVENT, listener);
    }
  });

  afterEach(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener(SAVE_REQUEST_EVENT, listener);
    }
  });

  it("fires the SAVE_REQUEST_EVENT on the window", () => {
    if (typeof window === "undefined") return; // happy-no-op when run under node-only env
    dispatchSaveRequest();
    expect(received).toBe(1);
  });

  it("multiple calls fire multiple events (the Toolbar listener is the one that no-ops)", () => {
    if (typeof window === "undefined") return;
    dispatchSaveRequest();
    dispatchSaveRequest();
    dispatchSaveRequest();
    expect(received).toBe(3);
  });

  it("no-ops cleanly when window is undefined (SSR / pre-render guard)", () => {
    // Simulated by stubbing globalThis.window briefly.
    const real = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = undefined;
    expect(() => dispatchSaveRequest()).not.toThrow();
    (globalThis as { window?: unknown }).window = real;
  });
});
