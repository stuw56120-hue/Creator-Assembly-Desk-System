/*
 * One timeline row. Renders span clips (cuts/MG/overlays/shorts) as draggable
 * TimelineClips, point events (chapters/transitions) as labelled markers, and —
 * on the video row — the retained keep segments behind the cut markers.
 */

import { TimelineClip } from "./TimelineClip";
import { GUTTER, KIND_COLOUR, ROW_H, clipLeft, type TimelineRow } from "./timelineGeometry";
import { useProjectStore } from "../project/projectStore";
import type { KeepSegment, TimelineEvent } from "../project/types";

interface TimelineTrackProps {
  row: TimelineRow;
  top: number;
  width: number;
  pixelsPerSecond: number;
  duration: number;
  events: TimelineEvent[];
  keepSegments: KeepSegment[];
  trackOrder: number[];
  selectedId: string | null;
}

function isPointEvent(e: TimelineEvent): boolean {
  return e.kind === "chapter" || e.kind === "transition";
}

export function TimelineTrack({
  row,
  top,
  width,
  pixelsPerSecond,
  duration,
  events,
  keepSegments,
  trackOrder,
  selectedId,
}: TimelineTrackProps) {
  const rowEvents = events.filter((e) => e.track === row.trackIndex);

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        width,
        height: ROW_H,
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* row label chip over the gutter */}
      <div
        style={{
          position: "sticky",
          left: 0,
          float: "left",
          width: GUTTER - 4,
          marginLeft: 2,
          marginTop: 4,
          fontSize: 10,
          fontWeight: 600,
          color: "var(--text-tertiary)",
          zIndex: 5,
        }}
      >
        {row.label}
      </div>

      {/* video row: retained keep segments behind the cuts */}
      {row.kind === "video" &&
        keepSegments.map((seg, i) => (
          <div
            key={`keep-${i}`}
            style={{
              position: "absolute",
              left: clipLeft(seg.start, pixelsPerSecond),
              top: 10,
              height: ROW_H - 20,
              width: Math.max(1, (seg.end - seg.start) * pixelsPerSecond),
              background: "var(--surface2)",
              borderRadius: 2,
            }}
          />
        ))}

      {rowEvents.map((event) =>
        isPointEvent(event) ? (
          <Marker
            key={event.id}
            event={event}
            pixelsPerSecond={pixelsPerSecond}
            selected={event.id === selectedId}
          />
        ) : (
          <TimelineClip
            key={event.id}
            event={event}
            pixelsPerSecond={pixelsPerSecond}
            rowHeight={ROW_H}
            trackOrder={trackOrder}
            duration={duration}
            selected={event.id === selectedId}
          />
        ),
      )}
    </div>
  );
}

function Marker({
  event,
  pixelsPerSecond,
  selected,
}: {
  event: TimelineEvent;
  pixelsPerSecond: number;
  selected: boolean;
}) {
  const left = clipLeft(event.start, pixelsPerSecond);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        useProjectStore.getState().setSelectedEvent(event.id);
      }}
      title={event.label}
      style={{ position: "absolute", left, top: 6, cursor: "pointer", userSelect: "none" }}
    >
      <div style={{ width: 2, height: ROW_H - 16, background: KIND_COLOUR[event.kind] }} />
      <span
        style={{
          position: "absolute",
          left: 4,
          top: 0,
          fontSize: 10,
          whiteSpace: "nowrap",
          color: selected ? "#fff" : "var(--text-secondary)",
          background: selected ? KIND_COLOUR[event.kind] : "transparent",
          padding: "0 3px",
          borderRadius: 2,
        }}
      >
        {event.reviewRequired ? "⚠ " : ""}
        {event.label}
      </span>
    </div>
  );
}
