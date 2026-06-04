/*
 * Timeline snapping toggle. Snapping locks a dragged clip to the playhead and to
 * other clips' start/end boundaries when within a small pixel threshold. The
 * threshold is in PIXELS (zoom-independent) so snapping gets more precise as the
 * user zooms in. Default on.
 */

import { create } from "zustand";

/** Snap distance in pixels, regardless of zoom. */
export const SNAP_PX = 8;

interface SnapState {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  toggle: () => void;
}

export const useSnapStore = create<SnapState>((set) => ({
  enabled: true,
  setEnabled: (on) => set({ enabled: on }),
  toggle: () => set((s) => ({ enabled: !s.enabled })),
}));

/**
 * Collect the times a dragged clip can snap to: the playhead plus every other
 * clip's start and end (any track). `excludeId` keeps a clip from snapping to
 * itself.
 */
export function collectSnapPoints(
  events: { id: string; start: number; duration: number }[],
  excludeId: string,
  playhead: number,
): number[] {
  const pts: number[] = [playhead];
  for (const e of events) {
    if (e.id === excludeId) continue;
    pts.push(e.start);
    pts.push(e.start + e.duration);
  }
  return pts;
}

/**
 * Snap `value` (seconds) to the nearest point within `thresholdSeconds`.
 * Returns the snapped value, or the original when nothing is close enough.
 */
export function snapValue(value: number, points: number[], thresholdSeconds: number): number {
  let best = value;
  let bestDelta = thresholdSeconds;
  for (const p of points) {
    const d = Math.abs(value - p);
    if (d <= bestDelta) {
      best = p;
      bestDelta = d;
    }
  }
  return best;
}
