/*
 * Vertical playhead. Subscribes to liveTime and repositions itself via a ref on
 * every frame — no React state, no per-frame re-render (spec constraint).
 */

import { useEffect, useRef } from "react";
import { getTimelinePlayheadLeft } from "./layout";
import { GUTTER } from "./timelineGeometry";
import { usePlayerStore } from "../player/playerStore";
import { playbackController, subscribeLiveTime } from "../player/usePlayback";

interface TimelinePlayheadProps {
  pixelsPerSecond: number;
  height: number;
}

export function TimelinePlayhead({ pixelsPerSecond, height }: TimelinePlayheadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const currentTime = usePlayerStore((s) => s.currentTime);
  // Read the live pps inside drag handlers without re-binding them.
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;

  useEffect(() => {
    const position = (t: number) => {
      if (ref.current) {
        ref.current.style.transform = `translateX(${getTimelinePlayheadLeft(t, pixelsPerSecond)}px)`;
      }
    };
    position(currentTime); // initial / after zoom change
    const unsubscribe = subscribeLiveTime(position);
    return () => {
      unsubscribe();
    };
  }, [pixelsPerSecond, currentTime]);

  // Drag the marker to scrub. Map the pointer to a time using the playhead's
  // offset parent (the scrollable timeline content) as the origin.
  function timeFromClientX(clientX: number): number {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    const left = (parent ?? el)?.getBoundingClientRect().left ?? 0;
    const x = clientX - left - GUTTER;
    return Math.max(0, x / Math.max(ppsRef.current, 1));
  }

  function onHandlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: PointerEvent) => playbackController.seek(timeFromClientX(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 1,
        height,
        background: "#ff3b3b",
        pointerEvents: "none",
        zIndex: 12,
        willChange: "transform",
      }}
    >
      {/* Grab handle — the only pointer-interactive part of the playhead. */}
      <div
        onPointerDown={onHandlePointerDown}
        style={{
          position: "absolute",
          top: 0,
          left: -7,
          width: 15,
          height: 14,
          cursor: "ew-resize",
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 2,
            width: 0,
            height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "7px solid #ff3b3b",
          }}
        />
      </div>
    </div>
  );
}
