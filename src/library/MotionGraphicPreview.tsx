/*
 * Small looping preview of a rendered motion graphic WebM. Used by the Studio
 * (live Preview) and the Motion Graphic Inspector.
 */

/**
 * URL for a local asset the renderer can load. Chromium blocks file:// from the
 * dev server's http origin, so we route through the cads-asset:// protocol
 * (registered in the main process), which works in dev and packaged alike.
 */
export function assetUrl(absolutePath: string): string {
  return `cads-asset://local/${encodeURIComponent(absolutePath)}`;
}

import { useEffect, useRef, useState } from "react";

interface MotionGraphicPreviewProps {
  /** Absolute path to a WebM, or null when nothing has been rendered yet. */
  assetPath: string | null;
  height?: number;
}

export function MotionGraphicPreview({ assetPath, height = 180 }: MotionGraphicPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  // Autoplay can be blocked, which leaves the <video> frozen on a transparent
  // first frame (animations build in) — looking like a blank panel. Force a
  // play() once the data is ready so the graphic actually animates.
  useEffect(() => {
    setFailed(false);
    const v = videoRef.current;
    if (!v || !assetPath) return;
    const start = () => void v.play().catch(() => {});
    v.addEventListener("loadeddata", start);
    if (v.readyState >= 2) start();
    return () => v.removeEventListener("loadeddata", start);
  }, [assetPath]);

  return (
    <div
      style={{
        height,
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        background:
          "repeating-conic-gradient(var(--surface2) 0% 25%, var(--surface) 0% 50%) 50% / 24px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {assetPath && !failed ? (
        <video
          key={assetPath}
          ref={videoRef}
          src={assetUrl(assetPath)}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
      ) : (
        <span style={{ color: failed ? "#ff6b6b" : "var(--text-tertiary)", fontSize: "var(--font-size-caption)", padding: "0 12px", textAlign: "center" }}>
          {failed
            ? "Couldn’t play the rendered preview. The graphic was built — try Rebuild, or check the motion-graphics engine."
            : "No preview yet — build or preview a graphic"}
        </span>
      )}
    </div>
  );
}
