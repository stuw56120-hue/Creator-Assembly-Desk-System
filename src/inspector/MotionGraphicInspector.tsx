/*
 * Motion Graphic Inspector. Shows the template, its editable params, a live
 * Preview, and a Rebuild button that re-renders the WebM with current params
 * and updates the timeline clip (per spec Step 5 / Motion Graphic Inspector).
 */

import { useState } from "react";
import { ParamForm } from "../library/ParamForm";
import { RangeField } from "./fields";
import { MotionGraphicPreview } from "../library/MotionGraphicPreview";
import { useProjectStore } from "../project/projectStore";
import type { TimelineEvent } from "../project/types";
import { isBackgroundEligible } from "../motionGraphics/backgroundEligibility";
import { MotionGraphicBackgroundControls } from "./MotionGraphicBackgroundControls";
import { useAppStore } from "../app/appStore";
import { rebuildButtonState, type RebuildPhase } from "./rebuildButtonState";

type Phase = RebuildPhase;

export function MotionGraphicInspector({ event }: { event: TimelineEvent }) {
  const mg = event.motionGraphicData;
  const [params, setParams] = useState<Record<string, unknown>>(() => ({ ...(mg?.params ?? {}) }));
  const [phase, setPhase] = useState<Phase>("idle");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  if (!mg) return null;
  const busy = phase === "previewing" || phase === "rebuilding";

  async function onPreview(overrideParams?: Record<string, unknown>) {
    setPhase("previewing");
    setMessage("");
    try {
      const { previewPath: p } = await window.cads.motionGraphics.preview({
        templateId: mg!.templateId,
        // Background controls fire requestPreview immediately after onChange in
        // the same tick — pass the next-params explicitly so the preview uses
        // the value the user just chose, not last render's stale snapshot.
        params: overrideParams ?? params,
        projectFolder: useAppStore.getState().project?.projectDir ?? "",
      });
      setPreviewPath(p);
      setPhase("done");
    } catch (err) {
      setMessage((err as Error).message);
      setPhase("error");
    }
  }

  async function onRebuild() {
    // Guard against a stray second click landing between the first click and
    // the next render committing `phase === "rebuilding"`. Without this an
    // impatient double-click could fire two parallel rebuild IPCs.
    if (phase === "rebuilding") return;
    setPhase("rebuilding");
    setMessage("");
    const store = useProjectStore.getState();
    try {
      store.setMotionGraphicBuildStatus(event.id, "building");
      const result = await window.cads.motionGraphics.rebuild({
        assetId: mg!.mgId,
        templateId: mg!.templateId,
        params,
        projectFolder: useAppStore.getState().project?.projectDir ?? "",
      });
      store.updateMotionGraphicParams(event.id, params);
      if (typeof params.duration === "number") {
        store.updateEvent(event.id, { duration: params.duration });
      }
      store.setMotionGraphicBuildStatus(event.id, "ready", result.assetPath);
      setPreviewPath(result.assetPath);
      setPhase("done");
      setMessage("Rebuilt");
    } catch (err) {
      // Reset the button via setPhase("error") — see rebuildButtonState:
      // "error" is one of the resting states, so the button label/disabled
      // both come back to their idle values even on a synchronous throw.
      store.setMotionGraphicBuildStatus(event.id, "error");
      setMessage((err as Error).message);
      setPhase("error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <div style={{ fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>
        Template: <strong style={{ color: "var(--text)" }}>{mg.templateId}</strong> · build:{" "}
        {mg.buildStatus}
      </div>
      <MotionGraphicPreview assetPath={previewPath} height={140} />
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button type="button" onClick={() => void onPreview()} disabled={busy} style={secondaryBtn}>
          {phase === "previewing" ? "…" : "Preview"}
        </button>
        {(() => {
          const s = rebuildButtonState(phase);
          return (
            <button
              type="button"
              onClick={onRebuild}
              disabled={s.disabled}
              className="btn-primary"
              style={
                s.error
                  ? { background: "#5a1b1b", borderColor: "#ff6b6b", color: "#ffd7d7" }
                  : undefined
              }
            >
              {s.showSpinner && <span className="cads-spinner" aria-hidden />}
              {s.label}
            </button>
          );
        })()}
      </div>
      {message && (
        <p
          style={{
            fontSize: "var(--font-size-caption)",
            color: phase === "error" ? "#ff6b6b" : "var(--accent-green)",
          }}
        >
          {message}
        </p>
      )}
      {/*
        Composite opacity of the whole motion graphic over the video. Lives in
        overlayData (not a composition param), so changing it updates the live
        preview immediately (PreviewOverlays.MotionGraphicOverlay reads
        overlayData.opacity) without needing a rebuild.
      */}
      <RangeField
        label="Opacity"
        value={event.overlayData?.opacity ?? 1}
        onChange={(v) =>
          useProjectStore.getState().updateEvent(event.id, { overlayData: { opacity: v } })
        }
      />
      <ParamForm templateId={mg.templateId} params={params} onChange={setParams} />
      {isBackgroundEligible(mg.templateId) && (
        <MotionGraphicBackgroundControls
          params={params}
          onChange={setParams}
          requestPreview={(next) => void onPreview(next)}
        />
      )}
    </div>
  );
}

const secondaryBtn: React.CSSProperties = {
  fontSize: "0.8rem",
  padding: "0.4rem 1rem",
  borderRadius: "var(--radius-md)",
  background: "var(--surface2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  cursor: "pointer",
};
