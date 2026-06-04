/*
 * Per-MG background-image controls (file picker + opacity + fit + clear),
 * shown beneath ParamForm in the Motion Graphic Inspector for templates that
 * are eligible per backgroundEligibility.ts.
 *
 * Storage of the file lives in the main process (mgBackground:upload). The
 * params themselves ride along inside MotionGraphicData.params under three
 * keys:
 *
 *   background_image_id        — UUID issued by mgBackground:upload
 *   background_image_opacity   — 0..100 (DEFAULT_BG_OPACITY = 30); applied as
 *                                CSS opacity by the composition. Distinct from
 *                                quote_card's pre-existing `background_opacity`
 *                                (a 0..1 scrim opacity), which is why the new
 *                                field is `*_image_opacity` not the bare name
 *                                from the spec — same semantics, no collision.
 *   background_image_fit       — "cover" | "contain" | "tile"
 *
 * The Opacity slider debounces a `requestPreview` call by 250 ms so a drag
 * doesn't fire dozens of preview renders. Clear, file pick and Fit fire the
 * preview immediately (one event per user action).
 */

import { useEffect, useRef, useState } from "react";
import {
  ALLOWED_BG_EXTENSIONS,
  type BackgroundFit,
  DEFAULT_BG_FIT,
  DEFAULT_BG_OPACITY,
  clampBackgroundOpacity,
} from "../motionGraphics/backgroundAssets";
import { assetUrl } from "../library/MotionGraphicPreview";
import { useAppStore } from "../app/appStore";

const FIT_OPTIONS: BackgroundFit[] = ["cover", "contain", "tile"];

interface Props {
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /**
   * Re-renders the inspector preview. Accepts an optional explicit params
   * snapshot — required for immediate-on-change calls (file pick, fit, clear)
   * because React state updates are batched, so reading `params` from the
   * closure on the next tick would still see the previous render's values.
   * The debounced opacity path can call it without an override (250 ms is
   * long enough for the state to commit).
   */
  requestPreview: (overrideParams?: Record<string, unknown>) => void;
}

interface ResolvedBg {
  filename: string;
  absolutePath: string;
}

export function MotionGraphicBackgroundControls({ params, onChange, requestPreview }: Props) {
  const projectFolder = useAppStore((s) => s.project?.projectDir ?? "");
  const id = typeof params.background_image_id === "string" ? params.background_image_id : "";
  const opacity = clampBackgroundOpacity(
    typeof params.background_image_opacity === "number"
      ? params.background_image_opacity
      : DEFAULT_BG_OPACITY,
  );
  const fit: BackgroundFit =
    params.background_image_fit === "cover" ||
    params.background_image_fit === "contain" ||
    params.background_image_fit === "tile"
      ? (params.background_image_fit as BackgroundFit)
      : DEFAULT_BG_FIT;

  const [resolved, setResolved] = useState<ResolvedBg | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Look up the on-disk filename/absolute path for the saved id, both on first
  // mount and whenever the id changes (after upload). Tolerant of missing files
  // — the renderer still shows the controls so the user can re-pick.
  useEffect(() => {
    let cancelled = false;
    setError("");
    if (!id || !projectFolder) {
      setResolved(null);
      return;
    }
    void window.cads.mgBackground.list({ projectFolder }).then((entries) => {
      if (cancelled) return;
      const entry = entries.find((e) => e.id === id);
      if (!entry) {
        setResolved(null);
        return;
      }
      const abs = absolutePathFor(projectFolder, entry.id, entry.ext);
      setResolved({ filename: entry.original_filename, absolutePath: abs });
    });
    return () => {
      cancelled = true;
    };
  }, [id, projectFolder]);

  // Debounce opacity to keep slider dragging snappy without flooding the
  // motion-graphics engine. 250 ms per spec.
  const debounceRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
  }, []);
  function scheduleDebouncedPreview() {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      requestPreview();
    }, 250);
  }

  async function onPick() {
    setError("");
    if (!projectFolder) {
      setError("Open a project first.");
      return;
    }
    const filter = {
      name: "Image",
      extensions: Array.from(ALLOWED_BG_EXTENSIONS).map((e) => e.replace(/^\./, "")),
    };
    const sourcePath = await window.cads.dialog.pickFile({
      title: "Choose a background image",
      filters: [filter],
    });
    if (!sourcePath) return;
    setBusy(true);
    try {
      const result = await window.cads.mgBackground.upload({ projectFolder, sourcePath });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const nextParams = {
        ...params,
        background_image_id: result.id,
        background_image_opacity: opacity || DEFAULT_BG_OPACITY,
        background_image_fit: fit,
      };
      onChange(nextParams);
      // Update the thumbnail immediately; the useEffect on `id` would do the
      // same eventually but this avoids the round-trip flash.
      setResolved({ filename: result.originalFilename, absolutePath: result.absolutePath });
      requestPreview(nextParams);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onClear() {
    if (!id) return; // no-op when nothing is set (per spec)
    const next = { ...params };
    delete next.background_image_id;
    delete next.background_image_opacity;
    delete next.background_image_fit;
    onChange(next);
    setResolved(null);
    requestPreview(next);
  }

  function onOpacityChange(v: number) {
    onChange({ ...params, background_image_opacity: clampBackgroundOpacity(v) });
    scheduleDebouncedPreview();
  }

  function onFitChange(v: BackgroundFit) {
    const next = { ...params, background_image_fit: v };
    onChange(next);
    requestPreview(next);
  }

  return (
    <fieldset
      style={{
        margin: 0,
        padding: "var(--space-sm)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
      }}
    >
      <legend style={{ padding: "0 var(--space-xs)", fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>
        Background image
      </legend>

      <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-start" }}>
        {/* Thumbnail / placeholder */}
        <div
          style={{
            width: 120,
            height: 67, // 16:9
            flexShrink: 0,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background:
              "repeating-conic-gradient(var(--surface2) 0% 25%, var(--surface) 0% 50%) 50% / 12px 12px",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {resolved ? (
            <img
              src={assetUrl(resolved.absolutePath)}
              alt={resolved.filename}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>none</span>
          )}
        </div>

        {/* Pick / Clear + filename */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={onPick} disabled={busy} style={btn}>
              {busy ? "Uploading…" : id ? "Replace…" : "Choose image…"}
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={!id || busy}
              style={btn}
              title={id ? "Remove the background image" : "Nothing to clear"}
            >
              Clear
            </button>
          </div>
          {resolved && (
            <div
              style={{
                fontSize: "var(--font-size-caption)",
                color: "var(--text-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={resolved.filename}
            >
              {resolved.filename}
            </div>
          )}
          {id && !resolved && (
            <div style={{ fontSize: "var(--font-size-caption)", color: "#ff6b6b" }}>
              Saved image is missing on disk — pick a new one.
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr 48px",
          gap: "var(--space-sm)",
          alignItems: "center",
          marginTop: "var(--space-sm)",
        }}
      >
        <label style={lbl}>Opacity</label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          aria-label="Background opacity"
        />
        <span style={{ fontSize: "var(--font-size-caption)", color: "var(--text-secondary)", textAlign: "right" }}>
          {opacity}%
        </span>

        <label style={lbl}>Fit</label>
        <select
          value={fit}
          onChange={(e) => onFitChange(e.target.value as BackgroundFit)}
          style={{ gridColumn: "2 / span 2", ...input }}
        >
          {FIT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p style={{ marginTop: "var(--space-xs)", fontSize: "var(--font-size-caption)", color: "#ff6b6b" }}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Mirror of electron-side path layout (kept simple — POSIX-style join works on Windows for renderer-side use). */
function absolutePathFor(projectFolder: string, id: string, ext: string): string {
  const sep = projectFolder.includes("\\") ? "\\" : "/";
  return [projectFolder, "assets", "mg-backgrounds", `${id}${ext}`].join(sep);
}

const lbl: React.CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--text-secondary)",
};

const input: React.CSSProperties = {
  padding: "4px 6px",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
};

const btn: React.CSSProperties = {
  fontSize: "0.8rem",
  padding: "0.35rem 0.7rem",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  cursor: "pointer",
};
