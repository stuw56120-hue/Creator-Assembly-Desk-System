/*
 * Timeline zoom: Fit (auto-scale to viewport) vs. manual percent.
 */

import { usePlayerStore } from "../player/playerStore";

export function ZoomControl() {
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const percent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setPercent = usePlayerStore((s) => s.setManualZoomPercent);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
      <button
        type="button"
        onClick={() => setZoomMode("fit")}
        style={{
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: zoomMode === "fit" ? "var(--accent-blue-light)" : "transparent",
          color: "var(--text)",
          cursor: "pointer",
        }}
      >
        Fit
      </button>
      <input
        type="range"
        min={10}
        max={800}
        value={percent}
        onChange={(e) => {
          setPercent(Number(e.target.value));
          setZoomMode("manual");
        }}
        style={{ width: 120 }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-tertiary)",
          width: 42,
        }}
      >
        {zoomMode === "manual" ? `${percent}%` : "fit"}
      </span>
    </div>
  );
}
