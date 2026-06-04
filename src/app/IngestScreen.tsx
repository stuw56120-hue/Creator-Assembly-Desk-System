/*
 * Step 1 — New Project / ingest. Name the project, drag in the Zoom MP4 (and
 * optionally the VTT), pick language + Whisper model, hit Go. C.A.D.S. copies
 * the video, extracts audio, transcribes with Whisper, and produces the
 * submission folder. A live log streams progress; the green Ready screen offers
 * "Open Submission Folder" and "Continue to Import".
 */

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "./appStore";
import { WHISPER_MODELS, isAcceptedTranscript, isAcceptedVideo } from "../project/ingestPlan";
import { getPipelineDefaults } from "../config/presets";
import { deserializeProject } from "../project/projectSnapshot";
import { reopenProject } from "../project/loadProject";

type Status = "idle" | "running" | "done" | "error";

const INGEST_DEFAULTS = getPipelineDefaults().ingest;

/** Map an ingest log line to a coarse progress-bar stage label (or null). */
function coarseStage(line: string): string | null {
  if (/copying/i.test(line)) return "Copying";
  if (/extracting audio/i.test(line)) return "Extracting audio";
  if (/transcrib|whisper/i.test(line)) return "Transcribing";
  return null;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function DropZone({
  label,
  hint,
  value,
  accept,
  onPick,
  validate,
}: {
  label: string;
  hint: string;
  value: string;
  accept: string;
  onPick: (path: string) => void;
  validate: (path: string) => boolean;
}) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");

  function handlePath(p: string | undefined) {
    if (!p) return;
    if (!validate(p)) {
      setErr(`That file type isn’t accepted here.`);
      return;
    }
    setErr("");
    onPick(p);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
        handlePath(file?.path);
      }}
      onClick={async () => {
        const exts = accept.split(",").map((s) => s.replace(".", ""));
        const picked = await window.cads.dialog.pickFile({
          title: label,
          filters: [{ name: label, extensions: exts }],
        });
        handlePath(picked ?? undefined);
      }}
      style={{
        border: `2px dashed ${over ? "var(--accent-blue)" : "var(--border-light)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-lg)",
        textAlign: "center",
        cursor: "pointer",
        background: over ? "var(--accent-blue-light)" : "var(--surface)",
        marginBottom: "var(--space-md)",
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>{hint}</div>
      {value && (
        <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: "var(--font-size-caption)", color: "var(--accent-green)" }}>
          ✓ {basename(value)}
        </div>
      )}
      {err && <div style={{ marginTop: 6, color: "#ff6b6b", fontSize: "var(--font-size-caption)" }}>{err}</div>}
    </div>
  );
}

export function IngestScreen() {
  const setProject = useAppStore((s) => s.setProject);
  const setPhase = useAppStore((s) => s.setPhase);
  const setPendingTranscript = useAppStore((s) => s.setPendingTranscript);

  const [name, setName] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [vttPath, setVttPath] = useState("");
  const [language, setLanguage] = useState(INGEST_DEFAULTS.language);
  const [model, setModel] = useState(INGEST_DEFAULTS.whisper_model);
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [nameError, setNameError] = useState(false);
  const [openErr, setOpenErr] = useState("");
  const [lastIngest, setLastIngest] = useState<IngestResult | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Offer to continue the most recent completed ingest (so a reset UI / closed
  // window never forces re-running Whisper).
  useEffect(() => {
    window.cads?.ingest
      ?.last()
      .then(setLastIngest)
      .catch(() => setLastIngest(null));
  }, []);

  /** Jump to Import using an already-completed ingest: no Whisper re-run. */
  async function resumeIngest(manifest: IngestResult) {
    setProject(manifest);
    try {
      setPendingTranscript(await window.cads.project.readText(manifest.transcriptPath));
    } catch {
      /* transcript unreadable — captions can still be uploaded manually */
    }
    setPhase("import");
  }

  async function openExisting() {
    setOpenErr("");
    const dir = await window.cads.dialog.pickFolder({ title: "Open a project folder" });
    if (!dir) return;
    try {
      const found = await window.cads.project.open(dir);
      if (found.kind === "ingest") {
        // A completed ingest (manifest or reconstructed from submission/) → Import.
        await resumeIngest(found.manifest);
        return;
      }
      if (found.kind === "snapshot") {
        const result = deserializeProject(found.snapshot);
        if (!result.ok) {
          setOpenErr(`That project file is invalid: ${result.errors[0]}`);
          return;
        }
        await reopenProject(result.snapshot);
        setPhase("source"); // confirm the source video (it may have moved) before the editor
        return;
      }
      setOpenErr("No C.A.D.S. project or finished ingest was found in that folder.");
    } catch {
      setOpenErr("Couldn't open that folder.");
    }
  }

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  // Go is enabled once a video is chosen; the name is validated on click so an
  // empty name surfaces the red asterisk warning rather than silently doing nothing.
  const canGo = videoPath !== "" && status !== "running";

  async function onGo() {
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    setStatus("running");
    setLog([]);
    setProgress({ stage: "Starting", percent: 0 });
    const unsubscribe = window.cads.ingest.onLog((d) => {
      const stage = coarseStage(d.line);
      if (d.percent != null) {
        // Progress tick — update the bar in place, never append to the log.
        setProgress((p) => ({ stage: stage ?? p?.stage ?? "Working", percent: d.percent! }));
      } else {
        // One-off message (step header, error, etc.) — keep it in the log…
        setLog((l) => [...l, d.line]);
        // …and let stage headers advance the bar's label (percent resets per stage).
        if (stage) setProgress((p) => ({ stage, percent: p?.stage === stage ? p.percent : 0 }));
      }
    });
    try {
      const result = await window.cads.ingest.run({
        projectName: name,
        videoPath,
        vttPath: vttPath || undefined,
        language,
        model,
      });
      setProject(result);
      // Auto-populate the caption track. Prefer the Zoom VTT the user supplied
      // (real speaker names + exact cue timings) over the Whisper transcript;
      // applied automatically when the edit list is imported (no manual upload).
      try {
        const captionSource = vttPath || result.transcriptPath;
        const transcript = await window.cads.project.readText(captionSource);
        setPendingTranscript(transcript);
      } catch {
        /* unreadable — captions can still be uploaded manually later */
      }
      setStatus("done");
    } catch (err) {
      setLog((l) => [...l, `ERROR: ${(err as Error).message}`]);
      setStatus("error");
    } finally {
      unsubscribe();
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-2xl) var(--space-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "var(--space-lg)" }}>
        <h1>New Project</h1>
        <button type="button" onClick={openExisting} style={btn}>
          Open existing project…
        </button>
      </div>
      {openErr && (
        <p style={{ color: "#ff6b6b", fontSize: "var(--font-size-caption)", marginTop: -12 }}>{openErr}</p>
      )}

      {lastIngest && status !== "running" && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "var(--space-md)",
            border: "1px solid var(--accent-blue-border)",
            background: "var(--accent-blue-light)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-sm) var(--space-md)",
            marginBottom: "var(--space-lg)",
          }}
        >
          <span style={{ fontSize: "var(--font-size-body-sm)" }}>
            Last ingest: <strong>{lastIngest.projectName}</strong> is ready — its transcript is already
            done.
          </span>
          <button type="button" className="btn-primary" onClick={() => resumeIngest(lastIngest)}>
            Continue from last ingest →
          </button>
        </div>
      )}

      <label style={{ display: "block", marginBottom: "var(--space-lg)" }}>
        <span style={{ fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>
          Project name
          {nameError && <span style={{ color: "#ff6b6b", marginLeft: 4 }}>*</span>}
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(false);
          }}
          placeholder=""
          disabled={status === "running"}
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "var(--space-sm)",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${nameError ? "#ff6b6b" : "var(--border)"}`,
            background: "var(--surface2)",
            color: "var(--text)",
            boxSizing: "border-box",
          }}
        />
        {nameError && (
          <span style={{ color: "#ff6b6b", fontSize: "var(--font-size-caption)" }}>
            Please enter a project name to continue.
          </span>
        )}
      </label>

      <DropZone
        label="Drop your Zoom MP4"
        hint="Drag the recording here, or click to browse."
        value={videoPath}
        accept=".mp4,.mov,.mkv,.webm,.m4v"
        onPick={setVideoPath}
        validate={isAcceptedVideo}
      />
      <DropZone
        label="Drop the VTT transcript (optional)"
        hint="Zoom's transcript — kept for reference; Whisper makes the clean one."
        value={vttPath}
        accept=".vtt,.srt,.txt"
        onPick={setVttPath}
        validate={isAcceptedTranscript}
      />

      <div style={{ display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={status === "running"} style={selectStyle}>
            <option value="en">English</option>
            <option value="auto">Auto-detect</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
          </select>
        </label>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>Whisper model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={status === "running"} style={selectStyle}>
            {WHISPER_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === "base" ? " (recommended)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {status === "done" ? (
        <div
          style={{
            border: "1px solid var(--accent-green-border)",
            background: "var(--accent-green-light)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-md)",
          }}
        >
          <strong style={{ color: "var(--accent-green)" }}>✓ Ready</strong>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-body-sm)" }}>
            Your submission folder has the cleaned transcript and audio. Hand these to your customGPT.
            Captions are loaded from the transcript automatically when you import the edit list.
          </p>
          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <button
              type="button"
              onClick={() => {
                const dir = useAppStore.getState().project?.submissionDir;
                if (dir) window.cads.project.openPath(dir);
              }}
              style={btn}
            >
              Open Submission Folder
            </button>
            <button type="button" className="btn-primary" onClick={() => setPhase("import")}>
              Continue to Import →
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn-primary"
          disabled={!canGo}
          onClick={onGo}
          style={{ background: canGo ? "var(--accent-green)" : "var(--surface2)", color: canGo ? "#0a0a0a" : "var(--text-tertiary)" }}
        >
          {status === "running" ? "Working…" : "Go"}
        </button>
      )}

      {status === "running" && progress && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "var(--font-size-caption)",
              color: "var(--text-secondary)",
              marginBottom: 4,
            }}
          >
            <span>{progress.stage}…</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{Math.round(progress.percent)}%</span>
          </div>
          <div
            style={{
              height: 10,
              background: "var(--surface2)",
              borderRadius: 5,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, progress.percent))}%`,
                height: "100%",
                background: "var(--accent-blue)",
                transition: "width 0.2s ease-out",
              }}
            />
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="terminal" style={{ marginTop: "var(--space-lg)" }}>
          <div className="terminal-body" style={{ maxHeight: 220, overflowY: "auto" }}>
            {log.map((line, i) => (
              <div key={i} style={{ color: line.startsWith("ERROR") ? "#ff6b6b" : "var(--text-secondary)" }}>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "var(--space-sm)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

const btn: React.CSSProperties = {
  fontSize: 13,
  padding: "0.4rem 1rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};
