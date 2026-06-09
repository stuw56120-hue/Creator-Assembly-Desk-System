/*
 * Shorts approval queue. Walks the suggested shorts one at a time.
 *
 * v1 short (single clip, no segments[]): Approve renders the clip straight to a
 * vertical 9:16 MP4 (render:short v1 path), Skip moves on.
 *
 * v2 short (Shorts Schema v2, has segments[]): proxy-first. "Render Preview"
 * runs the pre-render lint then a 720p proxy; lint failures show as blocking
 * plain-English messages and no render happens. The proxy plays inline for
 * approval; "Approve & Render Full Quality" then renders the 1080p MP4 plus a
 * per-segment contact sheet, both openable when done. Skip moves on.
 */

import { useEffect, useState } from "react";
import { useProjectStore } from "../project/projectStore";
import { captionsWithinSpan, listShorts, overlaysWithinSpan, shortV2RenderPlan } from "../project/shortsQueue";
import { assetUrl } from "../library/MotionGraphicPreview";
import { formatTime } from "../player/time";

type V2Phase = "idle" | "rendering-proxy" | "blocked" | "proxy" | "rendering-full" | "full-done";

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

  // v2 per-short state (reset on next()).
  const [v2Phase, setV2Phase] = useState<V2Phase>("idle");
  const [v2Errors, setV2Errors] = useState<string[]>([]);
  const [proxyPath, setProxyPath] = useState("");
  // Re-rendering a preview reuses the same proxy path; bump this to force the
  // <video> to remount and re-fetch the new file instead of showing the old one.
  const [proxyNonce, setProxyNonce] = useState(0);
  const [fullPath, setFullPath] = useState("");
  const [contactSheet, setContactSheet] = useState<string | undefined>(undefined);
  const [percent, setPercent] = useState(0);

  const short = shorts[index];
  const done = index >= shorts.length;
  const isV2 = (short?.shortData?.segments?.length ?? 0) > 0;

  // Live render progress (the v2 handler streams phase "short").
  useEffect(() => {
    const unsub = window.cads.render.onProgress((d) => {
      if (d.phase === "short") setPercent(d.percent);
    });
    return unsub;
  }, []);

  function next() {
    setMessage("");
    setV2Phase("idle");
    setV2Errors([]);
    setProxyPath("");
    setProxyNonce(0);
    setFullPath("");
    setContactSheet(undefined);
    setPercent(0);
    setIndex((i) => i + 1);
  }

  function slugNum() {
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const num = String(index + 1).padStart(3, "0");
    return `${slug || "project"}-short-${num}.mp4`;
  }

  // ── v1 single-clip render ────────────────────────────────────────────────
  async function approveV1() {
    if (!short) return;
    if (!sourceVideoPath) {
      setMessage("No source video for this project — re-open it from its ingest folder.");
      return;
    }
    const inSeconds = short.start;
    const outSeconds = short.start + short.duration;

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
        defaultName: slugNum(),
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

  // ── v2 segment-assembly render (proxy → approve → full) ──────────────────
  async function renderV2(quality: "proxy" | "full") {
    if (!short?.shortData) return;
    if (!sourceVideoPath) {
      setMessage("No source video for this project — re-open it from its ingest folder.");
      return;
    }
    const plan = shortV2RenderPlan({
      shortData: short.shortData,
      events,
      sourcePath: sourceVideoPath,
      captionStyle: short.shortData.captionStyle || captionStyle,
      quality,
      defaultName: slugNum(),
    });

    setBusy(true);
    setMessage("");
    setV2Errors([]);
    setPercent(0);
    setV2Phase(quality === "proxy" ? "rendering-proxy" : "rendering-full");
    try {
      const result = await window.cads.render.short(plan);
      if (result.canceled) {
        // Only the full-quality save dialog can cancel — return to the proxy.
        setV2Phase(proxyPath ? "proxy" : "idle");
        return;
      }
      if (result.blocked) {
        setV2Errors(result.errors);
        setV2Phase("blocked");
        return;
      }
      if (result.quality === "full") {
        setFullPath(result.outputPath ?? "");
        setContactSheet(result.contactSheet);
        setApprovedCount((c) => c + 1);
        setV2Phase("full-done");
      } else {
        setProxyPath(result.outputPath ?? "");
        setProxyNonce((n) => n + 1);
        setV2Phase("proxy");
      }
    } catch (err) {
      setMessage(`Render failed: ${(err as Error).message}`);
      setV2Phase(proxyPath ? "proxy" : "idle");
    } finally {
      setBusy(false);
      setPercent(0);
    }
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={header}>
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
                {isV2 ? ` · ${short.shortData!.segments.length} segments` : ""}
              </div>

              {isV2 ? renderV2Body() : renderV1Body()}
            </>
          )}
        </div>
      </div>
    </div>
  );

  // ── v1 card (unchanged behaviour) ────────────────────────────────────────
  function renderV1Body() {
    return (
      <>
        <div style={preview916}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{short.shortData?.aspectRatio ?? "9:16"}</div>
          <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0" }}>{short.shortData?.hook || short.label}</div>
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

        {message && <p style={errorText}>{message}</p>}

        <div style={buttonRow}>
          <button type="button" onClick={next} disabled={busy} style={skipBtn}>
            Skip
          </button>
          <button type="button" className="btn-primary" onClick={approveV1} disabled={busy}>
            {busy ? "Rendering…" : "Approve Short"}
          </button>
        </div>
      </>
    );
  }

  // ── v2 proxy-first flow ──────────────────────────────────────────────────
  function renderV2Body() {
    const sd = short.shortData!;

    if (v2Phase === "rendering-proxy" || v2Phase === "rendering-full") {
      return (
        <div style={{ textAlign: "center", padding: "var(--space-lg) 0" }}>
          <p style={{ margin: 0 }}>{v2Phase === "rendering-proxy" ? "Rendering 720p preview…" : "Rendering full quality…"}</p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 24, margin: "var(--space-sm) 0" }}>{percent}%</p>
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>This can take a minute.</p>
        </div>
      );
    }

    if (v2Phase === "blocked") {
      return (
        <>
          <p style={{ fontWeight: 600, color: "#ff6b6b", marginBottom: "var(--space-xs)" }}>
            This short can't be rendered yet:
          </p>
          <ul style={{ fontSize: "var(--font-size-caption)", color: "var(--text)", paddingLeft: 18, lineHeight: 1.5 }}>
            {v2Errors.map((e, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{e}</li>
            ))}
          </ul>
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
            Fix these on the timeline, then check again.
          </p>
          <div style={buttonRow}>
            <button type="button" onClick={next} disabled={busy} style={skipBtn}>
              Skip
            </button>
            <button type="button" className="btn-primary" onClick={() => renderV2("proxy")} disabled={busy}>
              Check again
            </button>
          </div>
        </>
      );
    }

    if (v2Phase === "proxy") {
      return (
        <>
          <div style={{ display: "flex", justifyContent: "center", margin: "var(--space-md) 0" }}>
            <video
              key={`${proxyPath}#${proxyNonce}`}
              src={assetUrl(proxyPath)}
              controls
              autoPlay
              loop
              style={{ width: 180, height: 320, borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", background: "#000" }}
            />
          </div>
          <p style={{ textAlign: "center", color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
            720p preview — approve to render full quality.
          </p>
          {message && <p style={errorText}>{message}</p>}
          <div style={buttonRow}>
            <button type="button" onClick={next} disabled={busy} style={skipBtn}>
              Skip
            </button>
            <button type="button" onClick={() => renderV2("proxy")} disabled={busy} style={skipBtn}>
              Re-render Preview
            </button>
            <button type="button" className="btn-primary" onClick={() => renderV2("full")} disabled={busy}>
              Approve &amp; Render Full Quality
            </button>
          </div>
        </>
      );
    }

    if (v2Phase === "full-done") {
      return (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 32, margin: 0 }}>✓</p>
          <p style={{ color: "var(--text-secondary)" }}>Full-quality short rendered.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", alignItems: "center", margin: "var(--space-md) 0" }}>
            {fullPath && (
              <button type="button" onClick={() => window.cads.project.openPath(fullPath)} style={skipBtn}>
                Open Video
              </button>
            )}
            {contactSheet ? (
              <button type="button" onClick={() => window.cads.project.openPath(contactSheet!)} style={skipBtn}>
                Open Contact Sheet
              </button>
            ) : (
              <span style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
                (Contact sheet unavailable for this render.)
              </span>
            )}
          </div>
          <button type="button" className="btn-primary" onClick={next}>
            {index + 1 >= shorts.length ? "Finish" : "Next Short"}
          </button>
        </div>
      );
    }

    // v2Phase === "idle" — the spec card with a Render Preview button.
    return (
      <>
        <div style={preview916}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{sd.aspectRatio || "9:16"}</div>
          <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0" }}>{sd.hook || short.label}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-secondary)" }}>
            {sd.segments.length} segments · {sd.captionStyle || captionStyle}
          </div>
        </div>

        {short.reviewRequired && (
          <p style={{ color: "var(--accent-purple)", fontSize: "var(--font-size-caption)" }}>
            ⚠ This short's hook still needs a real spoken line (resolve it on the timeline first).
          </p>
        )}
        {sd.notes?.length ? (
          <ul style={{ fontSize: "var(--font-size-caption)", color: "var(--text-tertiary)", paddingLeft: 18 }}>
            {sd.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}

        {message && <p style={errorText}>{message}</p>}

        <div style={buttonRow}>
          <button type="button" onClick={next} disabled={busy} style={skipBtn}>
            Skip
          </button>
          <button type="button" className="btn-primary" onClick={() => renderV2("proxy")} disabled={busy}>
            Render Preview
          </button>
        </div>
      </>
    );
  }
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const panel: React.CSSProperties = {
  width: "min(560px, 92vw)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-xl)",
  overflow: "hidden",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "var(--space-sm) var(--space-md)",
  borderBottom: "1px solid var(--border)",
};

const preview916: React.CSSProperties = {
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
};

const buttonRow: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-sm)",
  justifyContent: "center",
  marginTop: "var(--space-md)",
  flexWrap: "wrap",
};

const errorText: React.CSSProperties = { color: "#ff6b6b", fontSize: "var(--font-size-caption)" };

const skipBtn: React.CSSProperties = {
  fontSize: 13,
  padding: "0.4rem 1rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};
