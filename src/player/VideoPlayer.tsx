/*
 * Centre preview. Plays the PROXY (never the full-resolution source, per spec).
 * When no proxy exists yet (dev / pre-render), shows a placeholder while the
 * virtual playback clock still drives the timeline playhead.
 */

import { useEffect, useRef } from "react";
import { assetUrl } from "../library/MotionGraphicPreview";
import { playbackController } from "./usePlayback";
import { usePlayerStore } from "./playerStore";
import { PreviewOverlays } from "./PreviewOverlays";
import { TimeReadout } from "./TimeReadout";

interface VideoPlayerProps {
  /** Absolute path to the generated proxy MP4, or null when not yet available. */
  proxyPath: string | null;
  /** True while the proxy is being generated (auto-run after import). */
  generating?: boolean;
  /** Proxy generation progress, 0–100. */
  percent?: number;
  /** Plain-English error if proxy generation failed. */
  error?: string | null;
}

export function VideoPlayer({ proxyPath, generating = false, percent = 0, error = null }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const audioMuted = usePlayerStore((s) => s.audioMuted);

  useEffect(() => {
    playbackController.bindVideo(videoRef.current);
    return () => playbackController.bindVideo(null);
  }, [proxyPath]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#000",
        minHeight: 0,
      }}
    >
      <div
        ref={stageRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {proxyPath ? (
          <video
            ref={videoRef}
            src={assetUrl(proxyPath)}
            muted={audioMuted}
            playsInline
            preload="auto"
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        ) : error ? (
          <div style={{ color: "#ff6b6b", fontSize: "var(--font-size-caption)", textAlign: "center", maxWidth: 420, padding: "0 var(--space-lg)" }}>
            {error}
          </div>
        ) : generating ? (
          <div style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: "var(--font-size-caption)", width: 280 }}>
            <div>Building video preview… {percent}%</div>
            <div style={{ height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
              <div style={{ width: `${percent}%`, height: "100%", background: "var(--accent-blue)" }} />
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
            No preview yet — it will appear here once the video proxy is ready.
          </div>
        )}

        {/* Live overlay compositing for review (images, memes, motion graphics). */}
        {proxyPath && (
          <PreviewOverlays stageRef={stageRef} videoRef={videoRef} proxyPath={proxyPath} />
        )}
      </div>
      <div
        style={{
          padding: "var(--space-xs) var(--space-md)",
          borderTop: "1px solid var(--border)",
          background: "var(--surface)",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <TimeReadout />
      </div>
    </div>
  );
}
