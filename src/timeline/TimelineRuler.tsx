/*
 * Time ruler. Generates ticks via the ported layout.generateTicks and labels
 * majors with formatTimelineTickLabel.
 */

import { useRef } from "react";
import { RULER_H, GUTTER } from "./timelineGeometry";
import { formatTimelineTickLabel, generateTicks } from "./layout";
import { playbackController } from "../player/usePlayback";

interface TimelineRulerProps {
  pixelsPerSecond: number;
  duration: number;
  width: number;
}

export function TimelineRuler({ pixelsPerSecond, duration, width }: TimelineRulerProps) {
  const { major, minor } = generateTicks(duration, pixelsPerSecond);
  const majorInterval = major.length >= 2 ? major[1] - major[0] : major[0] || 1;
  const ref = useRef<HTMLDivElement>(null);

  // Click anywhere on the ruler to seek, and drag along it to scrub.
  function seekAt(clientX: number) {
    const el = ref.current;
    if (!el) return;
    const x = clientX - el.getBoundingClientRect().left - GUTTER;
    playbackController.seek(Math.max(0, x / Math.max(pixelsPerSecond, 1)));
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    seekAt(e.clientX);
    const move = (ev: PointerEvent) => seekAt(ev.clientX);
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
      onPointerDown={onPointerDown}
      style={{
        // Sticky (vertical only — no `left`, so it still scrolls horizontally
        // with the tracks) keeps the ruler pinned to the top of the timeline as
        // the user scrolls down through the track rows.
        position: "sticky",
        top: 0,
        width,
        height: RULER_H,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        cursor: "ew-resize",
        zIndex: 11,
      }}
    >
      {minor.map((t) => (
        <div
          key={`mi-${t}`}
          style={{
            position: "absolute",
            left: GUTTER + t * pixelsPerSecond,
            bottom: 0,
            width: 1,
            height: 5,
            background: "var(--border-light)",
          }}
        />
      ))}
      {major.map((t) => (
        <div key={`ma-${t}`}>
          <div
            style={{
              position: "absolute",
              left: GUTTER + t * pixelsPerSecond,
              bottom: 0,
              width: 1,
              height: 9,
              background: "var(--text-tertiary)",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: GUTTER + t * pixelsPerSecond + 3,
              top: 2,
              fontSize: 10,
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {formatTimelineTickLabel(t, duration, majorInterval)}
          </span>
        </div>
      ))}
    </div>
  );
}
