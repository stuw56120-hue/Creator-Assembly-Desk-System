/*
 * A single timeline clip. Draggable (move) with resize handles on each edge,
 * selectable, and styled by kind. Disabled clips grey out; low-confidence clips
 * fade; clips needing review show a ⚠ badge; locked clips can't move/resize.
 */

import { CLIP_HANDLE_W } from "./layout";
import { KIND_COLOUR, clipLeft, clipWidth } from "./timelineGeometry";
import { useTimelineDrag } from "./useTimelineDrag";
import { useProjectStore } from "../project/projectStore";
import type { TimelineEvent } from "../project/types";

interface TimelineClipProps {
  event: TimelineEvent;
  pixelsPerSecond: number;
  rowHeight: number;
  trackOrder: number[];
  duration: number;
  selected: boolean;
}

export function TimelineClip({
  event,
  pixelsPerSecond,
  rowHeight,
  trackOrder,
  duration,
  selected,
}: TimelineClipProps) {
  const { preview, startMove, startResize } = useTimelineDrag({
    event,
    pixelsPerSecond,
    rowHeight,
    trackOrder,
    duration,
  });

  const geo = preview ?? event;
  const left = clipLeft(geo.start, pixelsPerSecond);
  const width = clipWidth(geo.duration, pixelsPerSecond);
  const colour = KIND_COLOUR[event.kind];
  const opacity = event.enabled ? 0.55 + 0.45 * event.confidence : 0.3;

  // Fade indicators (image clips): edge gradients whose widths track the
  // fade in/out durations, so the fade timing reads at a glance.
  const od = event.overlayData;
  const dur = Math.max(geo.duration, 0.001);
  const fadeInPx =
    event.kind === "image" && od?.fadeInSeconds
      ? Math.min(width / 2, (od.fadeInSeconds / dur) * width)
      : 0;
  const fadeOutPx =
    event.kind === "image" && od?.fadeOutSeconds
      ? Math.min(width / 2, (od.fadeOutSeconds / dur) * width)
      : 0;

  return (
    <div
      onPointerDown={startMove}
      onClick={(e) => {
        e.stopPropagation();
        useProjectStore.getState().setSelectedEvent(event.id);
      }}
      title={event.label}
      style={{
        position: "absolute",
        left,
        top: 4,
        height: rowHeight - 8,
        width,
        background: event.enabled ? colour : "var(--surface2)",
        opacity,
        borderRadius: "var(--radius-sm)",
        border: selected ? "2px solid #fff" : "1px solid rgba(0,0,0,0.35)",
        boxSizing: "border-box",
        color: "#fff",
        fontSize: 11,
        lineHeight: `${rowHeight - 10}px`,
        paddingLeft: 8,
        paddingRight: 8,
        whiteSpace: "nowrap",
        overflow: "hidden",
        cursor: event.locked ? "not-allowed" : "grab",
        userSelect: "none",
      }}
    >
      {fadeInPx > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: fadeInPx,
            background: "linear-gradient(to right, rgba(255,255,255,0.5), transparent)",
            pointerEvents: "none",
            borderTopLeftRadius: "var(--radius-sm)",
            borderBottomLeftRadius: "var(--radius-sm)",
          }}
        />
      )}
      {fadeOutPx > 0 && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: fadeOutPx,
            background: "linear-gradient(to left, rgba(255,255,255,0.5), transparent)",
            pointerEvents: "none",
            borderTopRightRadius: "var(--radius-sm)",
            borderBottomRightRadius: "var(--radius-sm)",
          }}
        />
      )}

      <span style={{ position: "relative", zIndex: 1 }}>
        {event.reviewRequired && <span style={{ marginRight: 4 }}>⚠</span>}
        {event.locked && <span style={{ marginRight: 4 }}>🔒</span>}
        {event.label}
      </span>

      {!event.locked && (
        <>
          <span
            onPointerDown={(e) => startResize("start", e)}
            style={{ ...handleStyle, left: 0 }}
          />
          <span
            onPointerDown={(e) => startResize("end", e)}
            style={{ ...handleStyle, right: 0 }}
          />
        </>
      )}
    </div>
  );
}

const handleStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  width: CLIP_HANDLE_W / 2,
  height: "100%",
  cursor: "ew-resize",
};
