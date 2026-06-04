/*
 * Live overlay preview. Composites the enabled image / meme / motion-graphic
 * overlays on top of the proxy video at the current playhead time — mirroring
 * (approximately) what the final FFmpeg render does, so the edit can be reviewed
 * before rendering. Built assets (image files, MG WebMs) render as media; an
 * overlay whose asset isn't built yet shows a labelled placeholder so its timing
 * and position are still reviewable.
 *
 * Also renders the live caption (lower third, styled by the project caption
 * style) and a brief chapter-title card when the playhead crosses a chapter.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { assetUrl } from "../library/MotionGraphicPreview";
import { useProjectStore } from "../project/projectStore";
import { playbackController, subscribeLiveTime } from "./usePlayback";
import type { TimelineEvent } from "../project/types";

const OVERLAY_KINDS = new Set(["motion_graphic", "image", "meme"]);
/** How long a chapter title stays on screen after the playhead crosses it. */
const CHAPTER_DISPLAY_SECONDS = 3;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Track the displayed video box relative to the stage, so overlays align to it. */
function useVideoRect(
  stageRef: RefObject<HTMLElement>,
  videoRef: RefObject<HTMLVideoElement>,
  proxyPath: string | null,
): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    const measure = () => {
      const v = videoRef.current;
      const s = stageRef.current;
      if (!v || !s) return setRect(null);
      const vr = v.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      if (vr.width < 1 || vr.height < 1) return setRect(null);
      setRect({ left: vr.left - sr.left, top: vr.top - sr.top, width: vr.width, height: vr.height });
    };
    measure();
    const raf = requestAnimationFrame(measure); // after layout settles
    const ro = new ResizeObserver(measure);
    if (videoRef.current) ro.observe(videoRef.current);
    if (stageRef.current) ro.observe(stageRef.current);
    const v = videoRef.current;
    v?.addEventListener("loadedmetadata", measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      v?.removeEventListener("loadedmetadata", measure);
      window.removeEventListener("resize", measure);
    };
  }, [stageRef, videoRef, proxyPath]);
  return rect;
}

/** IDs of the overlays active at the current playhead time (updates only when the set changes). */
function useActiveOverlayIds(events: TimelineEvent[]): string[] {
  const [activeIds, setActiveIds] = useState<string[]>([]);
  useEffect(() => {
    const overlays = events.filter((e) => e.enabled && OVERLAY_KINDS.has(e.kind) && e.overlayData);
    const compute = (t: number) => {
      const ids = overlays
        .filter((e) => t >= e.start && t < e.start + Math.max(e.duration, 0.0001))
        .map((e) => e.id);
      setActiveIds((prev) =>
        prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
      );
    };
    compute(playbackController.getTime());
    const unsub = subscribeLiveTime(compute);
    return () => {
      unsub();
    };
  }, [events]);
  return activeIds;
}

interface PreviewOverlaysProps {
  stageRef: RefObject<HTMLElement>;
  videoRef: RefObject<HTMLVideoElement>;
  proxyPath: string | null;
}

export function PreviewOverlays({ stageRef, videoRef, proxyPath }: PreviewOverlaysProps) {
  const events = useProjectStore((s) => s.events);
  const rect = useVideoRect(stageRef, videoRef, proxyPath);
  const activeIds = useActiveOverlayIds(events);

  if (!rect) return null;
  const active = activeIds
    .map((id) => events.find((e) => e.id === id))
    .filter((e): e is TimelineEvent => Boolean(e?.overlayData));

  return (
    <div
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {active.map((e) =>
        e.kind === "image" ? (
          <DraggableImageOverlay key={e.id} event={e} frameW={rect.width} frameH={rect.height} />
        ) : e.kind === "motion_graphic" ? (
          <MotionGraphicOverlay key={e.id} event={e} />
        ) : (
          <OverlayItem key={e.id} event={e} frameW={rect.width} frameH={rect.height} />
        ),
      )}
      <ChapterTitleOverlay frameW={rect.width} frameH={rect.height} />
      <CaptionOverlay frameH={rect.height} />
    </div>
  );
}

/**
 * Normalise the customGPT's placement names to the keywords placementStyle
 * understands. The director emits top_/bottom_ variants; the renderer and this
 * preview use upper_/lower_. Keeping them in sync is what makes the placeholder
 * (and the built asset) land where the final render puts it.
 */
function normalizePlacement(placement: string): string {
  switch (placement) {
    case "top_left":
      return "upper_left";
    case "top_right":
      return "upper_right";
    case "bottom_left":
      return "lower_left";
    case "bottom_right":
      return "lower_right";
    case "top":
      return "top_center";
    case "bottom":
      return "bottom_center";
    default:
      return placement;
  }
}

/** Mirror renderExporter.placementExpr as CSS, with a margin proportional to the frame. */
function placementStyle(placement: string, margin: number): React.CSSProperties {
  // Corners get the HORIZONTAL inset halved (sit closer to L/R edges); vertical
  // inset is unchanged so a corner image doesn't clip the caption band.
  const hCorner = Math.round(margin / 2);
  switch (normalizePlacement(placement)) {
    case "full":
      return { left: 0, top: 0, width: "100%", height: "100%" };
    case "left_center":
      return { left: margin, top: "50%", transform: "translateY(-50%)" };
    case "right_center":
      return { right: margin, top: "50%", transform: "translateY(-50%)" };
    case "upper_left":
      return { left: hCorner, top: margin };
    case "upper_right":
      return { right: hCorner, top: margin };
    case "lower_left":
      return { left: hCorner, bottom: margin };
    case "lower_right":
      return { right: hCorner, bottom: margin };
    case "top_center":
      return { left: "50%", top: margin, transform: "translateX(-50%)" };
    case "bottom_center":
      return { left: "50%", bottom: margin, transform: "translateX(-50%)" };
    case "center":
    default:
      return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  }
}

/**
 * Motion graphics are authored as full-frame 1920×1080 alpha compositions with
 * their own internal positioning, so they cover the whole video frame (matching
 * the render, where the 1920×1080 overlay composites over the 1920×1080 video).
 * Rendering them at a fraction of the width is what made them look "too far right
 * and small".
 */
function MotionGraphicOverlay({ event }: { event: TimelineEvent }) {
  const od = event.overlayData!;
  const url = od.assetPath ? assetUrl(od.assetPath) : null;
  const building = event.motionGraphicData?.buildStatus === "building";
  return (
    <div style={{ position: "absolute", inset: 0, opacity: od.opacity ?? 1, pointerEvents: "none" }}>
      {url ? (
        <video
          src={url}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            border: "1px dashed rgba(255,255,255,0.65)",
            background: "rgba(0,0,0,0.45)",
            color: "#fff",
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 4,
          }}
        >
          {building ? "⟳ " : ""}
          {event.label || "Motion graphic"}
        </div>
      )}
    </div>
  );
}

/**
 * A player image overlay the user can drag to reposition and resize by its
 * corners. Position/size live in overlayData (x, y = normalised CENTRE; width =
 * normalised to the frame width) and are committed to the project store on
 * release (one undo entry, and persisted in the saved project). Opacity fades
 * in/out per the overlay's fade_*_duration_seconds.
 */
function DraggableImageOverlay({
  event,
  frameW,
  frameH,
}: {
  event: TimelineEvent;
  frameW: number;
  frameH: number;
}) {
  const od = event.overlayData!;
  const selected = useProjectStore((s) => s.selectedEventId === event.id);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ x: od.x ?? 0.5, y: od.y ?? 0.5, w: od.width || 0.4 });
  const liveBox = useRef(box);
  const dragging = useRef(false);

  // Keep in sync with the store when not actively dragging (e.g. undo/redo).
  useEffect(() => {
    if (dragging.current) return;
    const next = { x: od.x ?? 0.5, y: od.y ?? 0.5, w: od.width || 0.4 };
    liveBox.current = next;
    setBox(next);
  }, [od.x, od.y, od.width]);

  // Entry/exit animation driven from the live clock (no per-frame re-render).
  // Default to a fade in/out; "none" = instant.
  const entry = od.entry ?? "fade";
  const exit = od.exit ?? "fade";
  const fadeIn = od.fadeInSeconds ?? 0.5;
  const fadeOut = od.fadeOutSeconds ?? 0.5;
  const baseOpacity = od.opacity ?? 1;
  const animate = entry !== "none" || exit !== "none";
  useEffect(() => {
    if (!animate) return;
    const el = wrapRef.current;
    if (!el) return;
    const start = event.start;
    const end = event.start + event.duration;
    const slide = frameW * 0.12; // slide distance in px
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const apply = (t: number) => {
      let opacity = baseOpacity;
      let tx = 0;
      let scale = 1;
      if (entry !== "none" && fadeIn > 0 && t < start + fadeIn) {
        const p = clamp01((t - start) / fadeIn); // 0→1 entering
        if (entry === "fade") opacity *= p;
        else if (entry === "slide_in_left") { tx = -(1 - p) * slide; opacity *= clamp01(p * 1.5); }
        else if (entry === "slide_in_right") { tx = (1 - p) * slide; opacity *= clamp01(p * 1.5); }
        else if (entry === "pop_in") { scale = 0.6 + 0.4 * p; opacity *= p; }
      } else if (exit !== "none" && fadeOut > 0 && t > end - fadeOut) {
        const q = clamp01((end - t) / fadeOut); // 1→0 leaving
        if (exit === "fade") opacity *= q;
        else if (exit === "slide_out_left") { tx = -(1 - q) * slide; opacity *= clamp01(q * 1.5); }
        else if (exit === "slide_out_right") { tx = (1 - q) * slide; opacity *= clamp01(q * 1.5); }
      }
      el.style.opacity = String(clamp01(opacity));
      el.style.transform = `translate(-50%, -50%) translateX(${tx.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    };
    apply(playbackController.getTime());
    const unsub = subscribeLiveTime(apply);
    return () => {
      unsub();
    };
  }, [animate, entry, exit, fadeIn, fadeOut, baseOpacity, frameW, event.start, event.duration]);

  function commit() {
    useProjectStore.getState().updateEvent(event.id, {
      overlayData: { x: liveBox.current.x, y: liveBox.current.y, width: liveBox.current.w },
    });
  }

  function beginDrag(e: React.PointerEvent, mode: "move" | "resize", dirX: number) {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    useProjectStore.getState().setSelectedEvent(event.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...liveBox.current };
    const onMove = (ev: PointerEvent) => {
      if (mode === "move") {
        const x = Math.min(1, Math.max(0, orig.x + (ev.clientX - startX) / frameW));
        const y = Math.min(1, Math.max(0, orig.y + (ev.clientY - startY) / frameH));
        liveBox.current = { ...orig, x, y };
      } else {
        // Resize symmetrically about the centre; corner direction sets the sign.
        const w = Math.min(1, Math.max(0.05, orig.w + (2 * dirX * (ev.clientX - startX)) / frameW));
        liveBox.current = { ...orig, w };
      }
      setBox(liveBox.current);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragging.current = false;
      commit();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const url = od.assetPath ? assetUrl(od.assetPath) : null;
  const handle = (corner: string, dirX: number, css: React.CSSProperties) => (
    <div
      onPointerDown={(e) => beginDrag(e, "resize", dirX)}
      style={{
        position: "absolute",
        width: 12,
        height: 12,
        background: "var(--accent-blue, #4a9eff)",
        border: "1px solid #fff",
        borderRadius: 2,
        cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
        pointerEvents: "auto",
        ...css,
      }}
    />
  );

  return (
    <div
      ref={wrapRef}
      onPointerDown={(e) => beginDrag(e, "move", 1)}
      style={{
        position: "absolute",
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        transform: "translate(-50%, -50%)",
        opacity: animate ? 0 : baseOpacity,
        transition: animate ? "opacity 80ms linear, transform 80ms linear" : undefined,
        pointerEvents: "auto",
        cursor: "move",
        outline: selected ? "2px solid var(--accent-blue, #4a9eff)" : "1px dashed rgba(255,255,255,0.4)",
      }}
    >
      {url ? (
        <img src={url} alt="" draggable={false} style={{ width: "100%", height: "auto", display: "block" }} />
      ) : (
        <div
          style={{
            background: "rgba(0,0,0,0.5)",
            border: "1px dashed rgba(255,255,255,0.65)",
            color: "#fff",
            fontSize: 11,
            padding: "10px 6px",
            textAlign: "center",
            borderRadius: 4,
          }}
        >
          {event.label || "Image"} — not collected yet
        </div>
      )}
      {selected && (
        <>
          {handle("nw", -1, { left: -6, top: -6 })}
          {handle("ne", 1, { right: -6, top: -6 })}
          {handle("sw", -1, { left: -6, bottom: -6 })}
          {handle("se", 1, { right: -6, bottom: -6 })}
        </>
      )}
    </div>
  );
}

function OverlayItem({
  event,
  frameW,
}: {
  event: TimelineEvent;
  frameW: number;
  frameH: number;
}) {
  const od = event.overlayData!;
  const wrapRef = useRef<HTMLDivElement>(null);
  const margin = Math.round(frameW * 0.03);
  const isFull = normalizePlacement(od.placement) === "full";
  const widthPx = isFull ? undefined : Math.round((od.width || 0.4) * frameW);
  const url = od.assetPath ? assetUrl(od.assetPath) : null;
  const isVideoAsset = Boolean(od.assetPath) && /\.webm$/i.test(od.assetPath);
  const building = event.motionGraphicData?.buildStatus === "building";

  // Player images fade in/out (player_image_overlays fade_*_duration_seconds).
  // Drive opacity straight on the DOM node from the live clock — no per-frame
  // React re-render — and let a short CSS transition smooth the frame steps.
  const fadeIn = event.kind === "image" ? od.fadeInSeconds ?? 0 : 0;
  const fadeOut = event.kind === "image" ? od.fadeOutSeconds ?? 0 : 0;
  const hasFade = fadeIn > 0 || fadeOut > 0;
  const baseOpacity = od.opacity ?? 1;

  useEffect(() => {
    if (!hasFade) return;
    const el = wrapRef.current;
    if (!el) return;
    const start = event.start;
    const end = event.start + event.duration;
    const apply = (t: number) => {
      let o = baseOpacity;
      if (fadeIn > 0 && t < start + fadeIn) o *= Math.max(0, (t - start) / fadeIn);
      if (fadeOut > 0 && t > end - fadeOut) o *= Math.max(0, (end - t) / fadeOut);
      el.style.opacity = String(Math.max(0, Math.min(1, o)));
    };
    apply(playbackController.getTime());
    const unsub = subscribeLiveTime(apply);
    return () => {
      unsub();
    };
  }, [hasFade, fadeIn, fadeOut, baseOpacity, event.start, event.duration]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        ...placementStyle(od.placement, margin),
        ...(isFull ? {} : { width: widthPx }),
        opacity: hasFade ? 0 : baseOpacity, // fade effect takes over immediately on mount
        transition: hasFade ? "opacity 80ms linear" : undefined,
      }}
    >
      {url ? (
        isVideoAsset ? (
          <video
            src={url}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: "100%", height: isFull ? "100%" : "auto", objectFit: "contain", display: "block" }}
          />
        ) : (
          <img
            src={url}
            alt=""
            style={{ width: "100%", height: isFull ? "100%" : "auto", objectFit: "contain", display: "block" }}
          />
        )
      ) : (
        <div
          style={{
            border: "1px dashed rgba(255,255,255,0.65)",
            background: "rgba(0,0,0,0.45)",
            color: "#fff",
            fontSize: 11,
            padding: "4px 6px",
            borderRadius: 4,
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={`${kindLabel(event.kind)} — ${building ? "building…" : "not built yet"}`}
        >
          {building ? "⟳ " : ""}
          {event.label || kindLabel(event.kind)}
        </div>
      )}
    </div>
  );
}

/** The caption segment under the playhead, as a lower-third overlay. */
function CaptionOverlay({ frameH }: { frameH: number }) {
  const events = useProjectStore((s) => s.events);
  const captionStyle = useProjectStore((s) => s.captionStyle);
  const isKaraoke = captionStyle === "karaoke_highlight";
  const [active, setActive] = useState<{ text: string } | null>(null);
  // Index of the word currently being "sung" (karaoke only).
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const captions = events.filter((e) => e.kind === "caption" && e.enabled && e.captionData);
    const compute = (t: number) => {
      const c = captions.find((e) => t >= e.start && t < e.start + Math.max(e.duration, 0.01));
      const next = c ? { text: c.captionData!.text || c.label } : null;
      setActive((prev) => (prev?.text === next?.text ? prev : next));
      if (isKaraoke && c) {
        // No word-level timing from the transcript yet, so split the segment's
        // duration equally across its words (a good approximation). A full
        // implementation would use per-word timestamps from Whisper.
        const words = (c.captionData!.text || c.label).trim().split(/\s+/).filter(Boolean);
        const frac = (t - c.start) / Math.max(c.duration, 0.01);
        const idx = Math.max(0, Math.min(words.length - 1, Math.floor(frac * words.length)));
        setWordIndex((prev) => (prev === idx ? prev : idx));
      }
    };
    compute(playbackController.getTime());
    const unsub = subscribeLiveTime(compute);
    return () => {
      unsub();
    };
  }, [events, isKaraoke]);

  if (!active || !active.text.trim()) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: Math.round(frameH * 0.07), // lower third — clear of faces
        display: "flex",
        justifyContent: "center",
        padding: "0 6%",
      }}
    >
      {isKaraoke ? (
        <span style={karaokeWrapStyle(frameH)}>
          {active.text
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((word, i) => (
              <span
                key={i}
                style={{
                  color: i <= wordIndex ? "#ffd84a" : "#fff", // sung words turn gold
                  fontWeight: i === wordIndex ? 800 : 700,
                  transition: "color 120ms linear",
                }}
              >
                {word}
                {" "}
              </span>
            ))}
        </span>
      ) : (
        <span style={captionTextStyle(captionStyle, frameH)}>{active.text}</span>
      )}
    </div>
  );
}

/** Wrapper for karaoke captions — dark band; per-word colour is set inline. */
function karaokeWrapStyle(frameH: number): React.CSSProperties {
  return {
    display: "inline-block",
    maxWidth: "100%",
    textAlign: "center",
    lineHeight: 1.25,
    fontSize: Math.max(13, Math.round(frameH * 0.045)),
    fontWeight: 700,
    padding: `${Math.round(frameH * 0.012)}px ${Math.round(frameH * 0.022)}px`,
    borderRadius: 6,
    background: "rgba(0,0,0,0.62)",
    textShadow: "0 1px 3px rgba(0,0,0,0.8)",
  };
}

/** Per-style caption appearance. Sizes scale with the displayed frame height. */
function captionTextStyle(style: string, frameH: number): React.CSSProperties {
  const fs = (mult: number) => Math.max(13, Math.round(frameH * mult));
  const base: React.CSSProperties = {
    display: "inline-block",
    maxWidth: "100%",
    textAlign: "center",
    lineHeight: 1.25,
    padding: `${Math.round(frameH * 0.012)}px ${Math.round(frameH * 0.022)}px`,
    borderRadius: 6,
  };
  switch (style) {
    case "bold_social":
      return {
        ...base,
        fontSize: fs(0.058),
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "#fff",
        background: "transparent",
        textShadow: "0 2px 8px rgba(0,0,0,0.95), 0 0 3px #000, 0 0 1px #000",
      };
    case "quote_emphasis":
      return {
        ...base,
        fontSize: fs(0.05),
        fontStyle: "italic",
        fontWeight: 500,
        color: "#fff",
        background: "rgba(0,0,0,0.5)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      };
    case "clean_podcast":
    default:
      return {
        ...base,
        fontSize: fs(0.042),
        fontWeight: 600,
        color: "#fff",
        background: "rgba(0,0,0,0.62)",
      };
  }
}

/** Default top-left anchor (normalised) for a chapter title card. */
const CHAPTER_DEFAULT_POS = { x: 0.04, y: 0.06 };

/**
 * A brief chapter title card shown for a few seconds after the playhead crosses
 * a chapter. Tracks the active chapter EVENT (not just its title) so the card
 * can be dragged and have its position persisted per chapter.
 */
function ChapterTitleOverlay({ frameW, frameH }: { frameW: number; frameH: number }) {
  const events = useProjectStore((s) => s.events);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const chapters = events
      .filter((e) => e.kind === "chapter")
      .sort((a, b) => a.start - b.start);
    const compute = (t: number) => {
      // The latest chapter whose boundary the playhead crossed within the window.
      let shown: string | null = null;
      for (const ch of chapters) {
        if (t >= ch.start && t < ch.start + CHAPTER_DISPLAY_SECONDS) shown = ch.id;
      }
      setActiveId((prev) => (prev === shown ? prev : shown));
    };
    compute(playbackController.getTime());
    const unsub = subscribeLiveTime(compute);
    return () => {
      unsub();
    };
  }, [events]);

  const chapter = activeId ? events.find((e) => e.id === activeId) : null;
  if (!chapter) return null;
  return <DraggableChapterTitle key={chapter.id} event={chapter} frameW={frameW} frameH={frameH} />;
}

/** The chapter title card itself — anchored top-left by default, drag to move. */
function DraggableChapterTitle({
  event,
  frameW,
  frameH,
}: {
  event: TimelineEvent;
  frameW: number;
  frameH: number;
}) {
  const cd = event.chapterData;
  const [pos, setPos] = useState({
    x: cd?.x ?? CHAPTER_DEFAULT_POS.x,
    y: cd?.y ?? CHAPTER_DEFAULT_POS.y,
  });
  const live = useRef(pos);
  const dragging = useRef(false);

  // Re-sync from the store when not dragging (undo/redo, or a different chapter).
  useEffect(() => {
    if (dragging.current) return;
    const next = { x: cd?.x ?? CHAPTER_DEFAULT_POS.x, y: cd?.y ?? CHAPTER_DEFAULT_POS.y };
    live.current = next;
    setPos(next);
  }, [cd?.x, cd?.y]);

  function beginDrag(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...live.current };
    const onMove = (ev: PointerEvent) => {
      const x = Math.min(0.96, Math.max(0, orig.x + (ev.clientX - startX) / frameW));
      const y = Math.min(0.92, Math.max(0, orig.y + (ev.clientY - startY) / frameH));
      live.current = { x, y };
      setPos({ x, y });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragging.current = false;
      useProjectStore
        .getState()
        .updateEvent(event.id, { chapterData: { x: live.current.x, y: live.current.y } });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      onPointerDown={beginDrag}
      style={{
        position: "absolute",
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        pointerEvents: "auto",
        cursor: "move",
      }}
    >
      <span
        style={{
          display: "inline-block",
          fontSize: Math.max(14, Math.round(frameH * 0.05)),
          fontWeight: 700,
          color: "#fff",
          letterSpacing: 0.3,
          padding: `${Math.round(frameH * 0.012)}px ${Math.round(frameH * 0.026)}px`,
          background: "rgba(0,0,0,0.55)",
          borderLeft: "3px solid var(--accent-blue, #4a9eff)",
          borderRadius: 4,
          textShadow: "0 1px 3px rgba(0,0,0,0.8)",
          whiteSpace: "nowrap",
        }}
      >
        {event.label}
      </span>
    </div>
  );
}

function kindLabel(kind: string): string {
  if (kind === "motion_graphic") return "Motion graphic";
  if (kind === "image") return "Image";
  if (kind === "meme") return "Meme";
  return "Overlay";
}
