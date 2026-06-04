/*
 * Scrollable timeline surface + drop target.
 *
 * Background clicks seek the playhead. Assets dragged from the library are
 * dropped here: resolveTimelineAssetDrop (ported) maps the pointer to a source
 * time, and a new TimelineEvent is added on the track for the asset's category.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { GUTTER, ROW_H } from "./timelineGeometry";
import { resolveTimelineAssetDrop } from "./layout";
import { playbackController } from "../player/usePlayback";
import { usePlayerStore } from "../player/playerStore";
import { useProjectStore } from "../project/projectStore";
import { TRACK, type TimelineEvent } from "../project/types";
import type { LibraryAsset } from "../library/assetStore";

/** Same numeric range as the toolbar ZoomControl. */
const ZOOM_MIN = 10;
const ZOOM_MAX = 800;

export const ASSET_DND_MIME = "application/x-cads-asset";

interface TimelineWorkAreaProps {
  pixelsPerSecond: number;
  duration: number;
  contentWidth: number;
  contentHeight: number;
  trackOrder: number[];
  children: ReactNode;
}

function assetToEvent(asset: LibraryAsset, start: number): TimelineEvent {
  const isMotionGraphic = asset.category === "motion_graphic";
  const track = isMotionGraphic
    ? TRACK.motionGraphics
    : asset.category === "image" || asset.category === "meme"
      ? TRACK.images
      : TRACK.images;
  return {
    id: `${asset.id}_${Date.now()}`,
    kind: asset.category,
    label: asset.filename,
    start,
    duration: asset.durationSeconds ?? 3,
    track,
    enabled: true,
    locked: false,
    reviewRequired: false,
    confidence: 1,
    overlayData: {
      assetPath: asset.absolutePath,
      assetId: asset.id,
      placement: "center",
      x: 0.5,
      y: 0.5,
      width: 0.4,
      opacity: 1,
    },
    motionGraphicData: isMotionGraphic
      ? {
          templateId: asset.templateId ?? "",
          params: asset.params ?? {},
          buildStatus: "ready",
          mgId: asset.id,
        }
      : undefined,
  };
}

export function TimelineWorkArea({
  pixelsPerSecond,
  duration,
  contentWidth,
  contentHeight,
  trackOrder,
  children,
}: TimelineWorkAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  // After a Ctrl+wheel zoom we want the cursor's timecode to stay UNDER the
  // cursor, so the wheel handler stashes the target scrollLeft here and the
  // layout effect (which fires after React re-renders with the new pps) applies
  // it. When this is null on a zoom change, the playhead is centred instead.
  const pendingScrollLeft = useRef<number | null>(null);
  // Keep the latest pps/zoom values reachable from the wheel listener without
  // re-attaching it on every render (and without stale closures).
  const live = useRef({ pixelsPerSecond, duration, zoomMode, manualZoomPercent });
  live.current = { pixelsPerSecond, duration, zoomMode, manualZoomPercent };

  function seekFromEvent(clientX: number) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - GUTTER;
    playbackController.seek(Math.max(0, x / Math.max(pixelsPerSecond, 1)));
  }

  // Ctrl+wheel zoom, centred on the cursor's horizontal position. We have to
  // bind via addEventListener with passive:false because React's onWheel
  // attaches a passive listener and can't preventDefault (browser would zoom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const cur = live.current;
      const oldPps = cur.pixelsPerSecond;
      if (oldPps <= 0) return;
      const rect = el!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      // Time under the cursor right now.
      const cursorTime = (el!.scrollLeft + cursorX - GUTTER) / oldPps;
      // Effective % regardless of fit-mode (fit ≈ 100% of the fit baseline).
      const currentPct = cur.zoomMode === "fit" ? 100 : cur.manualZoomPercent;
      // Smooth multiplicative zoom — about ±10% per typical wheel notch.
      const factor = Math.exp(-e.deltaY * 0.001);
      const rawPct = Math.round(currentPct * factor);
      const newPct = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, rawPct));
      if (newPct === currentPct && cur.zoomMode === "manual") return;
      // New pps is proportional to the % change; this avoids re-deriving fitPps.
      const newPps = oldPps * (newPct / currentPct);
      const newScrollLeft = cursorTime * newPps + GUTTER - cursorX;
      pendingScrollLeft.current = newScrollLeft;
      usePlayerStore.getState().setZoomMode("manual");
      usePlayerStore.getState().setManualZoomPercent(newPct);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // After a ZOOM (toolbar or wheel), apply the pending cursor-anchored scroll
  // OR centre the playhead. Watches zoomMode + manualZoomPercent so a viewport
  // resize (which changes pps but not the zoom level) doesn't re-centre.
  const firstRun = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    if (pendingScrollLeft.current !== null) {
      // Ctrl+wheel path — keep the time under the cursor in place.
      el.scrollLeft = Math.max(0, Math.min(pendingScrollLeft.current, maxScroll));
      pendingScrollLeft.current = null;
      return;
    }
    // Otherwise (toolbar Fit / slider): centre the playhead, pinning to the
    // nearer edge when there isn't enough timeline either side.
    const t = playbackController.getTime();
    const playheadX = t * pixelsPerSecond + GUTTER;
    const target = playheadX - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, Math.min(target, maxScroll));
  }, [zoomMode, manualZoomPercent, pixelsPerSecond]);

  return (
    <div
      ref={scrollRef}
      onClick={(e) => {
        // Only background clicks seek; clips/markers stopPropagation.
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.lane) {
          seekFromEvent(e.clientX);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ASSET_DND_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(ASSET_DND_MIME);
        if (!raw || !scrollRef.current) return;
        e.preventDefault();
        const asset = JSON.parse(raw) as LibraryAsset;
        const rect = scrollRef.current.getBoundingClientRect();
        const { start } = resolveTimelineAssetDrop(
          {
            rectLeft: rect.left,
            rectTop: rect.top,
            scrollLeft: scrollRef.current.scrollLeft,
            scrollTop: scrollRef.current.scrollTop,
            pixelsPerSecond,
            duration,
            trackHeight: ROW_H,
            trackOrder,
          },
          e.clientX,
          e.clientY,
        );
        useProjectStore.getState().addEvent(assetToEvent(asset, start));
      }}
      style={{ position: "relative", overflow: "auto", height: "100%", background: "var(--surface)" }}
    >
      <div
        data-lane="1"
        style={{ position: "relative", width: contentWidth, height: contentHeight }}
      >
        {children}
      </div>
    </div>
  );
}
