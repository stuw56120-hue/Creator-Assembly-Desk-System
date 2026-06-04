/*
 * Step 2 — Import Edit List. Two paths: import a JSON file the customGPT gave
 * you, or paste the JSON text directly. C.A.D.S. validates it and, on success,
 * opens the timeline editor. A "Load sample project" shortcut loads the bundled
 * Sweet Relief fixture for a quick look without ingesting real media.
 */

import { useState } from "react";
import { useAppStore } from "./appStore";
import { importEditListText } from "../project/editListImport";
import { applyEditList, loadSampleProject, startMotionGraphicBuilds } from "../project/loadProject";
import { getTemplateRegistry } from "../motionGraphics/templateRegistry";
import type { MotionGraphicBuildJob } from "../project/editListParser";

type Mode = "file" | "paste";

export function ImportScreen() {
  const project = useAppStore((s) => s.project);
  const setPhase = useAppStore((s) => s.setPhase);
  const pendingTranscript = useAppStore((s) => s.pendingTranscript);
  const setPendingTranscript = useAppStore((s) => s.setPendingTranscript);

  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [queuedBuilds, setQueuedBuilds] = useState<MotionGraphicBuildJob[]>([]);
  const [busy, setBusy] = useState(false);

  async function browseFile() {
    const file = await window.cads.dialog.pickFile({
      title: "Choose the edit list JSON",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!file) return;
    const contents = await window.cads.project.readText(file);
    setText(contents);
  }

  async function pasteFromClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      /* clipboard may be blocked — user can still Ctrl+V into the box */
    }
  }

  async function doImport() {
    setBusy(true);
    setErrors([]);
    setWarnings([]);
    const result = importEditListText(text, getTemplateRegistry());
    if (!result.ok) {
      setErrors(result.errors);
      setBusy(false);
      return;
    }
    // The transcript (ingest VTT/Whisper or a manual upload) becomes the caption
    // track as part of the load. Kept in app state across re-imports so it always
    // re-applies if the timeline is rebuilt — cleared only when we leave Import.
    await applyEditList(result.editList, {
      sourceVideoPath: project?.sourceVideoPath,
      transcriptText: pendingTranscript ?? undefined,
    });
    // Partial import: if some motion graphics were skipped, show the warnings
    // and let the user review before entering the editor (builds start on Continue).
    if (result.warnings.length > 0) {
      result.warnings.forEach((w) => window.cads?.log?.info(`import warning: ${w}`));
      setWarnings(result.warnings);
      setQueuedBuilds(result.buildQueue);
      setBusy(false);
      return;
    }
    proceed(result.buildQueue);
  }

  /** Commit the import: start motion-graphic builds in the background, then advance. */
  function proceed(buildQueue: MotionGraphicBuildJob[]) {
    startMotionGraphicBuilds(buildQueue);
    setPendingTranscript(null);
    setPhase("source");
  }

  async function loadSample() {
    setBusy(true);
    await loadSampleProject();
    setPhase("source");
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-2xl) var(--space-lg)" }}>
      <h1 style={{ marginBottom: "var(--space-sm)" }}>Import Edit List</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)" }}>
        Paste the JSON your customGPT produced, or import it as a file. C.A.D.S. validates it before
        opening the editor.
      </p>

      <div style={{ display: "flex", gap: 4, marginBottom: "var(--space-md)" }}>
        {(["paste", "file"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: mode === m ? "var(--accent-blue-light)" : "transparent",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            {m === "paste" ? "Paste text" : "Import a file"}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div style={{ marginBottom: "var(--space-md)" }}>
          <button type="button" className="btn-primary" onClick={browseFile}>
            Browse for file…
          </button>
          {text && (
            <span style={{ marginLeft: 10, color: "var(--accent-green)", fontSize: "var(--font-size-caption)" }}>
              ✓ Loaded {text.length} characters
            </span>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: "var(--space-md)" }}>
          <button type="button" onClick={pasteFromClipboard} style={btn}>
            Paste from clipboard
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the customGPT JSON here (or Ctrl+V)…"
            style={{
              display: "block",
              width: "100%",
              minHeight: 200,
              marginTop: "var(--space-sm)",
              padding: "var(--space-sm)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-caption)",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      {errors.length > 0 && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-sm) var(--space-md)",
            marginBottom: "var(--space-md)",
            background: "var(--surface)",
          }}
        >
          <strong style={{ color: "#ff6b6b" }}>The edit list didn’t validate:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>
            {errors.slice(0, 12).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div
          style={{
            border: "1px solid #d8a200",
            background: "rgba(224,160,32,0.12)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-sm) var(--space-md)",
            marginBottom: "var(--space-md)",
          }}
        >
          <strong style={{ color: "#e0a020" }}>
            ⚠ Imported with {warnings.length} item{warnings.length === 1 ? "" : "s"} skipped:
          </strong>
          <ul style={{ margin: "6px 0 var(--space-sm)", paddingLeft: 18, fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>
            {warnings.slice(0, 12).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <button type="button" className="btn-primary" onClick={() => proceed(queuedBuilds)}>
            Continue →
          </button>
        </div>
      )}

      <p
        style={{
          marginBottom: "var(--space-lg)",
          fontSize: "var(--font-size-caption)",
          color: "var(--text-tertiary)",
        }}
      >
        {pendingTranscript
          ? "✓ Captions will load from your ingest transcript automatically — fix any Whisper errors later in the Caption Editor."
          : "Captions load from your ingest transcript. If you imported without ingesting, you can add one anytime from the Caption Editor."}
      </p>

      <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!text.trim() || busy}
          onClick={doImport}
          style={{
            background: text.trim() ? "var(--accent-green)" : "var(--surface2)",
            color: text.trim() ? "#0a0a0a" : "var(--text-tertiary)",
          }}
        >
          Import →
        </button>
        <button type="button" onClick={loadSample} disabled={busy} style={btn}>
          Load sample project
        </button>
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
