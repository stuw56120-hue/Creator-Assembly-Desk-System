/*
 * Top-level timeline. Measures its width, derives pixels-per-second from the
 * zoom state, and lays out the ruler, track rows, and playhead inside the
 * scrollable work area. Renders directly from projectStore.events.
 */

import { useEffect, useRef, useState } from "react";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { TimelinePlayhead } from "./TimelinePlayhead";
import { TimelineWorkArea } from "./TimelineWorkArea";
import { GUTTER, RULER_H, ROW_H, buildTimelineRows, trackOrderFromRows } from "./timelineGeometry";
import { useProjectStore } from "../project/projectStore";
import { usePlayerStore } from "../player/playerStore";

export function TimelineCanvas() {
  const events = useProjectStore((s) => s.events);
  const keepSegments = useProjectStore((s) => s.keepSegments);
  const duration = useProjectStore((s) => s.durationSeconds);
  const selectedId = useProjectStore((s) => s.selectedEventId);
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoom = usePlayerStore((s) => s.manualZoomPercent);

  const outerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(960);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setViewportWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitPps = duration > 0 ? Math.max(1, (viewportWidth - GUTTER * 2) / duration) : 1;
  const pixelsPerSecond = zoomMode === "fit" ? fitPps : fitPps * (manualZoom / 100);

  const rows = buildTimelineRows(events);
  const trackOrder = trackOrderFromRows(rows);
  const contentWidth = Math.max(viewportWidth, GUTTER + duration * pixelsPerSecond + 40);
  const contentHeight = RULER_H + rows.length * ROW_H;

  return (
    <div ref={outerRef} style={{ height: "100%", minHeight: 0 }}>
      <TimelineWorkArea
        pixelsPerSecond={pixelsPerSecond}
        duration={duration}
        contentWidth={contentWidth}
        contentHeight={contentHeight}
        trackOrder={trackOrder}
      >
        <TimelineRuler
          pixelsPerSecond={pixelsPerSecond}
          duration={duration}
          width={contentWidth}
        />
        {rows.map((row, i) => (
          <TimelineTrack
            key={row.key}
            row={row}
            top={RULER_H + i * ROW_H}
            width={contentWidth}
            pixelsPerSecond={pixelsPerSecond}
            duration={duration}
            events={events}
            keepSegments={keepSegments}
            trackOrder={trackOrder}
            selectedId={selectedId}
          />
        ))}
        <TimelinePlayhead pixelsPerSecond={pixelsPerSecond} height={contentHeight} />
      </TimelineWorkArea>
    </div>
  );
}
