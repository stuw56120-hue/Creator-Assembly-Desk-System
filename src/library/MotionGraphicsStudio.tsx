/*
 * Motion Graphics Studio — create / preview / build a motion graphic from a
 * template. Pick a template, fill its params, Preview (renders to a temp file)
 * or Build (renders + saves to the Asset Library). Param validation gates the
 * actions. Driven entirely by the template registry.
 */

import { useState } from "react";
import { BUILT_IN_TEMPLATE_IDS, validateParams } from "../motionGraphics/templateRegistry";
import { initParams } from "./paramDefaults";
import { ParamForm } from "./ParamForm";
import { TemplateSelector } from "./TemplateSelector";
import { MotionGraphicPreview } from "./MotionGraphicPreview";

type Phase = "idle" | "previewing" | "building" | "ready" | "error";

export function MotionGraphicsStudio() {
  const [templateId, setTemplateId] = useState<string>(BUILT_IN_TEMPLATE_IDS[0]);
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    initParams(BUILT_IN_TEMPLATE_IDS[0]),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [assetPath, setAssetPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const { errors } = validateParams(templateId, params);
  const busy = phase === "previewing" || phase === "building";
  const canRender = errors.length === 0 && !busy;

  function selectTemplate(id: string) {
    setTemplateId(id);
    setParams(initParams(id));
    setAssetPath(null);
    setPhase("idle");
    setMessage("");
  }

  async function onPreview() {
    setPhase("previewing");
    setMessage("");
    try {
      const { previewPath } = await window.cads.motionGraphics.preview({ templateId, params });
      setAssetPath(previewPath);
      setPhase("ready");
    } catch (err) {
      setMessage((err as Error).message);
      setPhase("error");
    }
  }

  async function onBuild() {
    setPhase("building");
    setMessage("");
    try {
      const result = await window.cads.motionGraphics.build({
        assetId: `mg_${Date.now()}`,
        templateId,
        params,
      });
      setAssetPath(result.assetPath);
      setMessage(`Saved to library · ${result.durationSeconds}s`);
      setPhase("ready");
    } catch (err) {
      setMessage((err as Error).message);
      setPhase("error");
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr 320px",
        gap: "var(--space-lg)",
        padding: "var(--space-lg)",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <section style={{ overflowY: "auto" }}>
        <h3 style={{ marginBottom: "var(--space-sm)" }}>Templates</h3>
        <TemplateSelector selectedId={templateId} onSelect={selectTemplate} />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <h3>Preview</h3>
        <MotionGraphicPreview assetPath={assetPath} height={260} />
        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <button type="button" onClick={onPreview} disabled={!canRender} style={secondaryBtn}>
            {phase === "previewing" ? "Rendering…" : "Preview"}
          </button>
          <button type="button" onClick={onBuild} disabled={!canRender} className="btn-primary">
            {phase === "building" ? "Building…" : "Build"}
          </button>
        </div>
        {errors.length > 0 && (
          <p style={{ color: "var(--accent-purple)", fontSize: "var(--font-size-caption)" }}>
            {errors.join(" · ")}
          </p>
        )}
        {message && (
          <p
            style={{
              color: phase === "error" ? "#ff6b6b" : "var(--accent-green)",
              fontSize: "var(--font-size-caption)",
            }}
          >
            {message}
          </p>
        )}
      </section>

      <section style={{ overflowY: "auto" }}>
        <h3 style={{ marginBottom: "var(--space-sm)" }}>Parameters</h3>
        <ParamForm templateId={templateId} params={params} onChange={setParams} />
      </section>
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
