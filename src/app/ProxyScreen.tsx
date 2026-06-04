/*
 * Final step before the editor — generate the playback proxy.
 *
 * The editor plays a downscaled proxy (never the full-res source). This screen
 * builds it after the source + onboarding steps are confirmed, shows progress,
 * then opens the editor. If there's no source video it skips straight through;
 * if generation fails the user can still open the editor (no preview).
 */

import { useEffect } from "react";
import { useAppStore } from "./appStore";
import { useProjectStore } from "../project/projectStore";
import { useProxy } from "../player/useProxy";

export function ProxyScreen() {
  const sourceVideoPath = useProjectStore((s) => s.sourceVideoPath);
  const durationSeconds = useProjectStore((s) => s.durationSeconds);
  const setPhase = useAppStore((s) => s.setPhase);
  const setProxyPath = useAppStore((s) => s.setProxyPath);

  const proxy = useProxy(sourceVideoPath, durationSeconds);

  // No source video → nothing to build; open the editor with no preview.
  useEffect(() => {
    if (!sourceVideoPath) {
      setProxyPath(null);
      setPhase("editor");
    }
  }, [sourceVideoPath, setProxyPath, setPhase]);

  // Proxy ready → store it and open the editor.
  useEffect(() => {
    if (proxy.proxyPath) {
      setProxyPath(proxy.proxyPath);
      setPhase("editor");
    }
  }, [proxy.proxyPath, setProxyPath, setPhase]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-md)",
        padding: "var(--space-lg)",
      }}
    >
      {proxy.error ? (
        <>
          <div style={{ fontSize: 28 }}>⚠️</div>
          <div style={{ color: "#ff6b6b", textAlign: "center", maxWidth: 460 }}>{proxy.error}</div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setProxyPath(null);
              setPhase("editor");
            }}
          >
            Open editor without a preview →
          </button>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600 }}>Preparing your video preview…</div>
          <div style={{ width: 320, height: 8, background: "var(--surface2)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${proxy.percent}%`, height: "100%", background: "var(--accent-blue)", transition: "width 120ms linear" }} />
          </div>
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
            {proxy.percent}% — this only happens once per video.
          </div>
        </>
      )}
    </div>
  );
}
