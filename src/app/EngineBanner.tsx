/*
 * One-time "Downloading motion graphics engine…" indicator. Fixed to the top so
 * it overlays whatever screen is showing. Visible only while the engine is
 * downloading or if the download failed — silent once ready (or already present).
 */

import { useEngineStore } from "../motionGraphics/engineStore";

export function EngineBanner() {
  const state = useEngineStore((s) => s.state);
  const detail = useEngineStore((s) => s.detail);

  if (state !== "downloading" && state !== "error") return null;
  const isError = state === "error";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        padding: "var(--space-sm) var(--space-md)",
        background: isError ? "rgba(255,80,80,0.14)" : "rgba(40,120,255,0.14)",
        borderBottom: `1px solid ${isError ? "#ff6b6b" : "var(--accent-blue)"}`,
        color: "var(--text)",
        backdropFilter: "blur(4px)",
      }}
    >
      <span style={{ fontSize: 18 }}>{isError ? "⚠️" : "⏳"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: "var(--font-size-body-sm)" }}>
          {isError ? "Couldn’t set up the motion graphics engine" : "Downloading motion graphics engine…"}
        </strong>
        {!isError && (
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-caption)" }}>
            One-time setup so C.A.D.S. can render banners and graphics. You can keep working — this
            runs in the background.
          </div>
        )}
        {detail && (
          <div
            style={{
              color: "var(--text-tertiary)",
              fontSize: "var(--font-size-caption)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {detail}
          </div>
        )}
      </div>
      {!isError && (
        <div style={{ width: 120, height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
          {/* Indeterminate sweep — the CLI doesn't emit a reliable percentage. */}
          <div className="cads-indeterminate" style={{ height: "100%", width: "40%", background: "var(--accent-blue)" }} />
        </div>
      )}
      {isError && (
        <button
          type="button"
          onClick={() => useEngineStore.getState().set("idle")}
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
      )}
    </div>
  );
}
