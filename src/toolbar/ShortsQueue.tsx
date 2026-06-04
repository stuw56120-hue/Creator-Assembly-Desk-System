/*
 * Shorts approval queue (Step 8). Walks the suggested shorts one at a time:
 * shows the hook, in/out, aspect, and notes; Approve renders the clip to a
 * vertical 9:16 MP4 (render:short), Skip moves on. Closes when the queue ends.
 *
 * A rendered low-res preview per short would require generating a proxy clip up
 * front (heavy, and needs the source); instead each card shows the clip's spec
 * and the real render happens on Approve.
 */

import { useState } from "react";
import { useProjectStore } from "../project/projectStore";
import { captionsWithinSpan, listShorts, overlaysWithinSpan } from "../project/shortsQueue";
import { formatTime } from "../player/time";

export function ShortsQueue({ onClose }: { onClose: () => void }) {
  const events = useProjectStore((s) => s.events);
  const projectName = useProjectStore((s) => s.projectName);
  const sourceVideoPath = useProjectStore((s) => s.sourceVideoPath);
  const captionStyle = useProjectStore((s) => s.captionStyle);

  const shorts = listShorts(events);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [approvedCount, setApprovedCount] = useState(0);

  const short = shorts[index];
  const done = index >= shorts.length;

  function next() {
    setMessage("");
    setIndex((i) => i + 1);
  }

  async function approve() {
    if (!short) return;
    if (!sourceVideoPath) {
      setMessage("No source video for this project — re-open it from its ingest folder.");
      return;
    }
    const inSeconds = short.start;
    const outSeconds = short.start + short.duration;
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const num = String(index + 1).padStart(3, "0");

    setBusy(true);
    setMessage("");
    try {
      const result = await window.cads.render.short({
        sourcePath: sourceVideoPath,
        inSeconds,
        outSeconds,
        overlays: overlaysWithinSpan(events, inSeconds, outSeconds),
        captions: captionsWithinSpan(events, inSeconds, outSeconds),
        captionStyle,
        defaultName: `${slug || "project"}-short-${num}.mp4`,
      });
      if (!result.canceled) {
        setApprovedCount((c) => c + 1);
        next();
      }
    } catch (err) {
      setMessage(`Render failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
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
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
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
          <strong>Shorts</strong>
          <button type="button" onClick={onClose} style={{ cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "var(--space-lg)" }}>
          {done ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 40, margin: 0 }}>✓</p>
              <p style={{ color: "var(--text-secondary)" }}>
                {approvedCount} of {shorts.length} short{shorts.length === 1 ? "" : "s"} rendered.
              </p>
              <button type="button" className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          ) : (
            <>
              <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
                Short {index + 1} of {shorts.length}
              </div>

              {/* 9:16 preview placeholder showing the clip's spec. */}
              <div
                style={{
                  margin: "var(--space-md) auto",
                  width: 160,
                  height: 285,
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)",
                  background: "var(--surface2)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "var(--space-sm)",
                }}
              >
                <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  {short.shortData?.aspectRatio ?? "9:16"}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0" }}>
                  {short.shortData?.hook || short.label}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)" }}>
                  {formatTime(short.start)} – {formatTime(short.start + short.duration)}
                </div>
              </div>

              {short.reviewRequired && (
                <p style={{ color: "var(--accent-purple)", fontSize: "var(--font-size-caption)" }}>
                  ⚠ This short's hook still needs a real spoken line (resolve it on the timeline first).
                </p>
              )}
              {short.shortData?.notes?.length ? (
                <ul style={{ fontSize: "var(--font-size-caption)", color: "var(--text-tertiary)", paddingLeft: 18 }}>
                  {short.shortData.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}

              {message && (
                <p style={{ color: "#ff6b6b", fontSize: "var(--font-size-caption)" }}>{message}</p>
              )}

              <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "center", marginTop: "var(--space-md)" }}>
                <button type="button" onClick={next} disabled={busy} style={skipBtn}>
                  Skip
                </button>
                <button type="button" className="btn-primary" onClick={approve} disabled={busy}>
                  {busy ? "Rendering…" : "Approve Short"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const skipBtn: React.CSSProperties = {
  fontSize: 13,
  padding: "0.4rem 1rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};
