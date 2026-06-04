/*
 * Top toolbar: transport (play/pause), undo/redo, zoom, unresolved-review
 * counter, Approve (gated until zero ⚠ items), and Render Long-Form.
 */

import { useEffect, useRef, useState } from "react";
import { ZoomControl } from "./ZoomControl";
import { CaptionEditor } from "./CaptionEditor";
import { usePlayback } from "../player/usePlayback";
import { useProjectStore } from "../project/projectStore";
import { serializeProject } from "../project/projectSnapshot";
import { useSnapStore } from "../timeline/snapStore";
import { SAVE_REQUEST_EVENT } from "../hooks/saveShortcut";
import { ToastFadeController } from "../ui/toastFade";

const OVERLAY_KINDS = new Set(["motion_graphic", "image", "meme"]);

export function Toolbar() {
  const { isPlaying, toggle, seek } = usePlayback();

  const events = useProjectStore((s) => s.events);
  const approved = useProjectStore((s) => s.approved);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);

  const [render, setRender] = useState<{ busy: boolean; percent: number; message: string }>({
    busy: false,
    percent: 0,
    message: "",
  });
  // Save toast state — `visible` drives the CSS opacity transition, `msg ===
  // null` unmounts the element from the DOM so it can't intercept clicks.
  const [saveToast, setSaveToast] = useState<{ msg: string; visible: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [captionsOpen, setCaptionsOpen] = useState(false);

  // One ToastFadeController per Toolbar instance; cleared on unmount so a
  // pending fade timer can't fire after the component is gone.
  const fadeRef = useRef<ToastFadeController | null>(null);
  if (fadeRef.current === null) {
    fadeRef.current = new ToastFadeController(
      () => setSaveToast((t) => (t ? { ...t, visible: false } : t)),
      () => setSaveToast(null),
    );
  }
  useEffect(() => () => fadeRef.current?.clear(), []);

  function showSaveToast(msg: string) {
    setSaveToast({ msg, visible: true });
    fadeRef.current?.show();
  }
  const captionCount = events.filter((e) => e.kind === "caption").length;
  const snapEnabled = useSnapStore((s) => s.enabled);
  const setSnapEnabled = useSnapStore((s) => s.setEnabled);

  async function onSave() {
    // Guard against Ctrl+S + button-click colliding, or the user mashing
    // either while an existing save is in-flight. The window event listener
    // (further down) also defers to this flag.
    if (saving) return;
    setSaving(true);
    showSaveToast("Saving…");
    const p = useProjectStore.getState();
    try {
      const result = await window.cads.project.save({
        projectName: p.projectName,
        snapshot: serializeProject({
          projectName: p.projectName,
          durationSeconds: p.durationSeconds,
          sourceVideoPath: p.sourceVideoPath,
          approved: p.approved,
          events: p.events,
          keepSegments: p.keepSegments,
          playerDisplayNames: p.playerDisplayNames,
        }),
      });
      showSaveToast(`Saved → ${result.path}`);
    } catch (err) {
      showSaveToast(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // Window-level save request listener — fired by Ctrl/Cmd+S (see
  // saveShortcut.ts + useKeyboard.ts). Stored as a ref so the registered
  // handler always reaches the LATEST onSave (which closes over `saving`)
  // without re-binding the listener on every render.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  useEffect(() => {
    const handler = () => {
      void onSaveRef.current();
    };
    window.addEventListener(SAVE_REQUEST_EVENT, handler);
    return () => window.removeEventListener(SAVE_REQUEST_EVENT, handler);
  }, []);

  const unresolved = events.filter((e) => e.reviewRequired).length;
  const canApprove = !approved && unresolved === 0;

  async function onRenderLongform() {
    const project = useProjectStore.getState();
    if (!project.sourceVideoPath) {
      setRender({
        busy: false,
        percent: 0,
        message:
          "Render failed: no source video for this project. Re-open it from its ingest folder (Open existing project).",
      });
      return;
    }
    window.cads?.log?.info(`Render long-form — source: ${project.sourceVideoPath}`);
    const overlays = project.events
      .filter((e) => e.enabled && OVERLAY_KINDS.has(e.kind) && e.overlayData?.assetPath)
      .map((e) => ({
        inputPath: e.overlayData!.assetPath,
        sourceStart: e.start,
        duration: e.duration,
        placement: e.overlayData!.placement,
        // Use the store's current (possibly drag-adjusted) position/size for
        // images; motion graphics composite full-frame.
        ...(e.kind === "image"
          ? { x: e.overlayData!.x, y: e.overlayData!.y, width: e.overlayData!.width }
          : {}),
        fullFrame: e.kind === "motion_graphic",
        opacity: e.overlayData!.opacity,
      }));
    // Transition cues (enabled). The event label holds the transition type
    // (smash_cut / punch_zoom / …) — see buildTimeline.
    const transitions = project.events
      .filter((e) => e.kind === "transition" && e.enabled)
      .map((e) => ({ sourceStart: e.start, type: e.label }));
    // Caption track — handler writes a temp SRT and burns it in via the libass
    // `subtitles=` filter (see ffmpegHandlers + buildSubtitlesFilter).
    const captions = project.events
      .filter((e) => e.kind === "caption" && e.enabled && (e.captionData?.text ?? "").trim() !== "")
      .map((e) => ({ sourceStart: e.start, duration: e.duration, text: e.captionData!.text }));
    const slug = project.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    setRender({ busy: true, percent: 0, message: "" });
    const unsubscribe = window.cads.render.onProgress((d) =>
      setRender((r) => ({ ...r, percent: d.percent })),
    );
    try {
      const result = await window.cads.render.longform({
        sourcePath: project.sourceVideoPath,
        keepSegments: project.keepSegments,
        overlays,
        transitions,
        captions,
        captionStyle: project.captionStyle,
        defaultName: `${slug || "project"}-longform.mp4`,
      });
      setRender({
        busy: false,
        percent: 100,
        message: result.canceled ? "" : `Rendered → ${result.outputPath}`,
      });
    } catch (err) {
      setRender({ busy: false, percent: 0, message: `Render failed: ${(err as Error).message}` });
    } finally {
      unsubscribe();
    }
  }

  return (
    <header
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        padding: "var(--space-sm) var(--space-md)",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <strong style={{ letterSpacing: 2 }}>C.A.D.S.</strong>

      <button type="button" onClick={() => seek(0)} style={btn} title="Return to start (Home)">
        ⏮
      </button>

      <button type="button" onClick={toggle} style={btn} title="Play / Pause (Space)">
        {isPlaying ? "❚❚" : "▶"}
      </button>

      <div style={{ display: "flex", gap: 4 }}>
        <button
          type="button"
          onClick={() => useProjectStore.getState().undo()}
          disabled={!canUndo}
          style={btn}
          title="Undo"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={() => useProjectStore.getState().redo()}
          disabled={!canRedo}
          style={btn}
          title="Redo"
        >
          ↷
        </button>
      </div>

      <button type="button" onClick={onSave} style={btn} title="Save project">
        Save
      </button>

      <button
        type="button"
        onClick={() => setCaptionsOpen(true)}
        style={btn}
        title="Edit captions / fix transcription"
      >
        Captions{captionCount > 0 ? ` (${captionCount})` : ""}
      </button>

      <ZoomControl />

      <label
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--font-size-caption)", color: "var(--text-secondary)", cursor: "pointer", userSelect: "none" }}
        title="Snap clips to the playhead and to other clip edges"
      >
        <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
        Snap
      </label>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <span
          style={{
            fontSize: "var(--font-size-caption)",
            color: unresolved > 0 ? "var(--accent-purple)" : "var(--text-tertiary)",
          }}
        >
          {unresolved > 0 ? `⚠ ${unresolved} to resolve` : "All resolved"}
        </span>

        {approved ? (
          <button
            type="button"
            onClick={() => useProjectStore.getState().unapprove()}
            style={{ ...btn, borderColor: "var(--accent-green-border)", color: "var(--accent-green)" }}
          >
            Approved ✓ — Unapprove
          </button>
        ) : (
          <button
            type="button"
            onClick={() => useProjectStore.getState().approve()}
            disabled={!canApprove}
            className="btn-primary"
            style={{
              background: canApprove ? "var(--accent-green)" : "var(--surface2)",
              color: canApprove ? "#0a0a0a" : "var(--text-tertiary)",
            }}
          >
            Approve Edit
          </button>
        )}

        <button
          type="button"
          disabled={!approved || render.busy}
          onClick={onRenderLongform}
          style={btn}
          title={approved ? "Render the long-form video" : "Approve the edit first"}
        >
          {render.busy ? `Rendering… ${render.percent}%` : "Render Long-Form"}
        </button>
        {/*
          Shorts rendering is not part of the longform workflow yet — the
          "Render Shorts" button was removed (premature). When shorts are
          supported this is where "Render Both" will live.
        */}
      </div>

      {captionsOpen && <CaptionEditor onClose={() => setCaptionsOpen(false)} />}

      {(render.message || saveToast) && (() => {
        // Render-progress messages take precedence and don't auto-fade — they
        // carry the rendered file path the user wants to see + copy. The
        // save toast carries the auto-fade via `saveToast.visible`.
        const msg = render.message || saveToast?.msg || "";
        const isRender = render.message.length > 0;
        const showAtFullOpacity = isRender || (saveToast?.visible ?? false);
        return (
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: "var(--space-md)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-xs) var(--space-sm)",
              fontSize: "var(--font-size-caption)",
              color: msg.includes("failed") ? "#ff6b6b" : "var(--accent-green)",
              maxWidth: 480,
              wordBreak: "break-all",
              zIndex: 50,
              opacity: showAtFullOpacity ? 1 : 0,
              // Don't intercept clicks once the fade has started — the
              // element stays in the DOM for the CSS transition only.
              pointerEvents: showAtFullOpacity ? "auto" : "none",
              transition: "opacity 400ms ease-out",
            }}
          >
            {msg}
          </div>
        );
      })()}
    </header>
  );
}

const btn: React.CSSProperties = {
  fontSize: 13,
  padding: "4px 10px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};
