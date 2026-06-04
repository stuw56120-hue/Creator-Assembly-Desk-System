/*
 * The C.A.D.S. editor surface (Step 4 of the UX): toolbar on top, the Asset
 * Library (left) · video preview (centre) · Inspector (right) in the middle,
 * and the multi-track Timeline along the bottom. The "+" in the library opens
 * the Motion Graphics Studio in an overlay.
 */

import { useState } from "react";
import { Toolbar } from "./toolbar/Toolbar";
import { AssetLibrary } from "./library/AssetLibrary";
import { MotionGraphicsStudio } from "./library/MotionGraphicsStudio";
import { VideoPlayer } from "./player/VideoPlayer";
import { InspectorPanel } from "./inspector/InspectorPanel";
import { TimelineCanvas } from "./timeline/TimelineCanvas";
import { useAppStore } from "./app/appStore";
import { useBuildAlertStore } from "./motionGraphics/buildAlertStore";
import { useKeyboard } from "./hooks/useKeyboard";

export function EditorLayout() {
  useKeyboard();
  const [studioOpen, setStudioOpen] = useState(false);

  // The proxy was generated in the proxy step before the editor opened. The
  // source-confirm and onboarding steps are now explicit phases (see appStore),
  // so the editor no longer gates internally.
  const proxyPath = useAppStore((s) => s.proxyPath);
  const buildAlert = useBuildAlertStore((s) => s.message);

  return (
    // overflow:hidden clamps the column to the viewport so the bottom timeline
    // (flexShrink:0) can never be pushed off-screen — e.g. by the build-alert
    // banner on a short window. The middle row scrolls internally instead.
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <Toolbar />

      {buildAlert && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-md)",
            padding: "var(--space-sm) var(--space-md)",
            background: "rgba(224,160,32,0.12)",
            borderBottom: "1px solid #d8a200",
            color: "var(--text)",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
          <div style={{ flex: 1, whiteSpace: "pre-wrap", fontSize: "var(--font-size-caption)", fontFamily: "var(--font-mono)" }}>
            {buildAlert}
          </div>
          <button
            type="button"
            onClick={() => useBuildAlertStore.getState().setMessage(null)}
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text)",
              borderRadius: "var(--radius-md)",
              padding: "2px 10px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 240, flexShrink: 0 }}>
          <AssetLibrary onCreateNew={() => setStudioOpen(true)} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <VideoPlayer proxyPath={proxyPath} />
        </div>
        <InspectorPanel />
      </div>

      <div style={{ height: 320, flexShrink: 0, borderTop: "1px solid var(--border)" }}>
        <TimelineCanvas />
      </div>

      {studioOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setStudioOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1100px, 92vw)",
              height: "min(720px, 88vh)",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xl)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "var(--space-sm) var(--space-md)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <strong>New Motion Graphic</strong>
              <button type="button" onClick={() => setStudioOpen(false)} style={{ cursor: "pointer" }}>
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <MotionGraphicsStudio />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
