/*
 * Timer behaviour for the "Saved" toast auto-fade.
 *
 * Drives vi.useFakeTimers() to walk the visible → fading → removed sequence
 * deterministically, and pins the reset-on-restart and clear-on-unmount
 * contracts the Toolbar relies on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastFadeController } from "./toastFade";

describe("ToastFadeController", () => {
  let fadeStarted: number;
  let removed: number;
  let c: ToastFadeController;

  beforeEach(() => {
    vi.useFakeTimers();
    fadeStarted = 0;
    removed = 0;
    c = new ToastFadeController(
      () => fadeStarted++,
      () => removed++,
    );
  });

  afterEach(() => {
    c.clear();
    vi.useRealTimers();
  });

  it("default cycle: 5 s opaque, 400 ms fade, then remove", () => {
    c.show();
    vi.advanceTimersByTime(4999);
    expect(fadeStarted).toBe(0);
    vi.advanceTimersByTime(1);
    expect(fadeStarted).toBe(1);
    expect(removed).toBe(0);
    vi.advanceTimersByTime(399);
    expect(removed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(removed).toBe(1);
  });

  it("show() during the opaque phase resets the timer", () => {
    c.show();
    vi.advanceTimersByTime(4000); // 4 s into the 5 s opaque window
    c.show(); // reset
    vi.advanceTimersByTime(4999);
    expect(fadeStarted).toBe(0); // only 4 999 ms since the reset
    vi.advanceTimersByTime(1);
    expect(fadeStarted).toBe(1);
  });

  it("show() during the fade aborts the fade and restarts at full opacity", () => {
    c.show();
    vi.advanceTimersByTime(5000); // entered fade
    expect(fadeStarted).toBe(1);
    c.show(); // restart — the queued onRemove callback must NOT fire
    vi.advanceTimersByTime(1000);
    expect(removed).toBe(0);
    // And the new cycle ticks from the restart.
    vi.advanceTimersByTime(3999);
    expect(fadeStarted).toBe(1); // not yet — only 4 999 ms after restart
    vi.advanceTimersByTime(1);
    expect(fadeStarted).toBe(2);
  });

  it("clear() cancels both pending timers (memory-leak guard)", () => {
    c.show();
    vi.advanceTimersByTime(2000);
    c.clear();
    vi.advanceTimersByTime(60_000);
    expect(fadeStarted).toBe(0);
    expect(removed).toBe(0);
  });

  it("clear() during the fade gap (between onFadeStart and onRemove) prevents removal", () => {
    c.show();
    vi.advanceTimersByTime(5000);
    expect(fadeStarted).toBe(1);
    c.clear();
    vi.advanceTimersByTime(1000);
    expect(removed).toBe(0);
  });

  it("custom durations are honoured", () => {
    const custom = new ToastFadeController(
      () => fadeStarted++,
      () => removed++,
      { fadeAfterMs: 100, fadeDurationMs: 50 },
    );
    custom.show();
    vi.advanceTimersByTime(99);
    expect(fadeStarted).toBe(0);
    vi.advanceTimersByTime(1);
    expect(fadeStarted).toBe(1);
    vi.advanceTimersByTime(50);
    expect(removed).toBe(1);
    custom.clear();
  });

  it("repeated clear() is safe (idempotent)", () => {
    c.clear();
    c.clear();
    c.show();
    c.clear();
    c.clear();
    expect(fadeStarted).toBe(0);
    expect(removed).toBe(0);
  });
});
