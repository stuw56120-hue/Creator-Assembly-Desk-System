/*
 * Step 1 of opening a project — Video Source.
 *
 * Always shown before the editor. Pre-fills the source video path from the
 * ingest manifest / edit list, checks whether that file is actually on disk,
 * and lets the user confirm it (green tick → Continue) or locate a different
 * one. Continue is enabled only once a real video is selected; a quiet escape
 * hatch allows proceeding with no preview (e.g. the sample project).
 */

import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "./appStore";
import { useProjectStore } from "../project/projectStore";
import { useOnboardingStore } from "../onboarding/onboardingStore";
import { startProxyGeneration } from "../player/useProxy";

const VIDEO_FILTERS = [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] }];

export function VideoSourceScreen() {
  const sourceVideoPath = useProjectStore((s) => s.sourceVideoPath);
  const setSourceVideoPath = useProjectStore((s) => s.setSourceVideoPath);
  const durationSeconds = useProjectStore((s) => s.durationSeconds);
  const requiredAssets = useOnboardingStore((s) => s.requiredAssets);
  const setPhase = useAppStore((s) => s.setPhase);

  const [exists, setExists] = useState<boolean | null>(null); // null = checking

  const check = useCallback(async (p: string) => {
    if (!p) {
      setExists(false);
      return;
    }
    setExists(null);
    const ok = (await window.cads?.project?.fileExists(p)) ?? false;
    setExists(ok);
  }, []);

  useEffect(() => {
    void check(sourceVideoPath);
  }, [sourceVideoPath, check]);

  async function locate() {
    const file = await window.cads.dialog.pickFile({
      title: "Locate the source video for this project",
      filters: VIDEO_FILTERS,
    });
    if (file) setSourceVideoPath(file); // triggers the existence re-check
  }

  // After the source is confirmed, kick off proxy generation immediately so it
  // runs in the background (during onboarding, if any), then advance. The proxy
  // step shows progress and waits for it to finish before the editor opens.
  function next() {
    startProxyGeneration(sourceVideoPath, durationSeconds);
    setPhase(requiredAssets.length > 0 ? "onboarding" : "proxy");
  }

  const fileName = sourceVideoPath ? sourceVideoPath.split(/[\\/]/).pop() : "";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-2xl) var(--space-lg)" }}>
      <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)", letterSpacing: 1, marginBottom: 6 }}>
        STEP 1 OF 2 · VIDEO SOURCE
      </div>
      <h1 style={{ marginBottom: "var(--space-sm)" }}>Confirm the source video.</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)" }}>
        C.A.D.S. edits and renders from this file. Check it&apos;s the right one — or locate it if
        it has moved.
      </p>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--surface)",
          padding: "var(--space-lg)",
          marginBottom: "var(--space-lg)",
        }}
      >
        {sourceVideoPath ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>
                {exists === null ? "⟳" : exists ? "✅" : "⚠️"}
              </span>
              <strong style={{ wordBreak: "break-all" }}>{fileName}</strong>
            </div>
            <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)", wordBreak: "break-all", marginBottom: "var(--space-sm)" }}>
              {sourceVideoPath}
            </div>
            <div style={{ fontSize: "var(--font-size-caption)", color: exists ? "var(--accent-green)" : "#e0a020" }}>
              {exists === null
                ? "Checking the file…"
                : exists
                  ? "Found on disk — ready to use."
                  : "This file isn’t where it used to be. Locate it to continue."}
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-secondary)" }}>
            No source video is set for this project yet. Choose the video file to edit.
          </div>
        )}

        <div style={{ marginTop: "var(--space-md)" }}>
          <button type="button" onClick={locate} style={btn}>
            {sourceVideoPath ? "Choose a different video…" : "Locate video…"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <button
          type="button"
          className="btn-primary"
          disabled={exists !== true}
          onClick={next}
          style={{
            background: exists === true ? "var(--accent-green)" : "var(--surface2)",
            color: exists === true ? "#0a0a0a" : "var(--text-tertiary)",
          }}
        >
          Continue →
        </button>
        {exists !== true && (
          <button
            type="button"
            onClick={next}
            style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: "var(--font-size-caption)", textDecoration: "underline" }}
            title="Open the editor without a video preview"
          >
            Continue without a preview
          </button>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  fontSize: 13,
  padding: "0.4rem 1rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};
