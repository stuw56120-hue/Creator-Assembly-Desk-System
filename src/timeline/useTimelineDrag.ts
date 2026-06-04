/*
 * Clip drag/resize interactions for the timeline.
 *
 * Uses the ported editing math (resolveTimelineMove / resolveTimelineResize).
 * A live `preview` is tracked in local state so dragging is smooth and only the
 * dragged clip re-renders; the store (and therefore one undo entry) is updated
 * once, on pointer-up. Locked clips ignore move/resize (spec constraint).
 */

import { useState } from "react";
import { resolveTimelineMove, resolveTimelineResize } from "./editing";
import { useProjectStore } from "../project/projectStore";
import { playbackController } from "../player/usePlayback";
import { SNAP_PX, collectSnapPoints, snapValue, useSnapStore } from "./snapStore";
import type { TimelineEvent } from "../project/types";

export interface DragPreview {
  start: number;
  duration: number;
  track: number;
}

interface UseTimelineDragArgs {
  event: TimelineEvent;
  pixelsPerSecond: number;
  rowHeight: number;
  trackOrder: number[];
  duration: number;
}

export function useTimelineDrag({
  event,
  pixelsPerSecond,
  rowHeight,
  trackOrder,
  duration,
}: UseTimelineDragArgs) {
  const [preview, setPreview] = useState<DragPreview | null>(null);

  /** Snap a candidate time to the playhead / other clip edges (when enabled). */
  function snapTime(value: number): number {
    if (!useSnapStore.getState().enabled) return value;
    const points = collectSnapPoints(
      useProjectStore.getState().events,
      event.id,
      playbackController.getTime(),
    );
    return snapValue(value, points, SNAP_PX / Math.max(pixelsPerSecond, 1));
  }

  function attach(onMove: (e: PointerEvent) => void) {
    const handleMove = (e: PointerEvent) => onMove(e);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      setPreview((current) => {
        if (current) useProjectStore.getState().updateEvent(event.id, current);
        return null;
      });
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function startMove(e: React.PointerEvent) {
    if (event.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const origin = { x: e.clientX, y: e.clientY };
    attach((ev) => {
      const { start, track } = resolveTimelineMove(
        {
          start: event.start,
          track: event.track,
          duration: event.duration,
          originClientX: origin.x,
          originClientY: origin.y,
          pixelsPerSecond,
          trackHeight: rowHeight,
          maxStart: Math.max(0, duration - event.duration),
          trackOrder,
        },
        ev.clientX,
        ev.clientY,
      );
      // Snap the leading or trailing edge to the nearest snap point.
      const byStart = snapTime(start);
      const byEnd = snapTime(start + event.duration);
      const startAdj = Math.abs(byStart - start);
      const endAdj = Math.abs(byEnd - (start + event.duration));
      let snappedStart = start;
      if (startAdj > 0 && startAdj <= endAdj) snappedStart = byStart;
      else if (endAdj > 0) snappedStart = byEnd - event.duration;
      const maxStart = Math.max(0, duration - event.duration);
      snappedStart = Math.max(0, Math.min(snappedStart, maxStart));
      setPreview({ start: snappedStart, duration: event.duration, track });
    });
  }

  function startResize(edge: "start" | "end", e: React.PointerEvent) {
    if (event.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const originX = e.clientX;
    attach((ev) => {
      const { start, duration: nextDuration } = resolveTimelineResize(
        {
          start: event.start,
          duration: event.duration,
          originClientX: originX,
          pixelsPerSecond,
          minStart: 0,
          maxEnd: duration,
        },
        edge,
        ev.clientX,
      );
      // Snap the edge being dragged (keeping the opposite edge fixed).
      let s = start;
      let d = nextDuration;
      if (edge === "start") {
        const end = start + nextDuration;
        s = Math.max(0, snapTime(start));
        d = Math.max(0.05, end - s);
      } else {
        const end = snapTime(start + nextDuration);
        d = Math.max(0.05, end - start);
      }
      setPreview({ start: s, duration: d, track: event.track });
    });
  }

  return { preview, startMove, startResize };
}
