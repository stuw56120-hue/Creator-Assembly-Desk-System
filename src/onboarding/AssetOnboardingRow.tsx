/*
 * A single asset row in the onboarding screen. Handles pending (upload),
 * processing (progress), done (three thumbnails), and error (retry) states, and
 * rejects non-image files client-side before sending to the worker.
 */

import { useEffect, useRef } from "react";
import { assetUrl } from "../library/MotionGraphicPreview";
import { useOnboardingStore } from "./onboardingStore";
import type { RequiredAsset } from "../project/editListParser";

const ACCEPTED = ["jpg", "jpeg", "png", "webp", "heic"];

export function AssetOnboardingRow({ asset }: { asset: RequiredAsset }) {
  const row = useOnboardingStore((s) => s.rows[asset.asset_id]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stream progress for this asset row.
  useEffect(() => {
    return window.cads?.image?.onUploadProgress((data) => {
      if (data.assetId !== asset.asset_id) return;
      useOnboardingStore.getState().setRowProgress(asset.asset_id, data.stage, data.percent);
    });
  }, [asset.asset_id]);

  function pick() {
    fileInputRef.current?.click();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const store = useOnboardingStore.getState();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED.includes(ext)) {
      store.setRowError(
        asset.asset_id,
        `“.${ext}” isn’t a supported image. Use JPG, PNG, WEBP, or HEIC.`,
      );
      return;
    }
    // Electron augments File with an absolute path.
    const filePath = (file as File & { path?: string }).path;
    if (!filePath) {
      store.setRowError(asset.asset_id, "Could not read the file path for this image.");
      return;
    }

    store.setRowStatus(asset.asset_id, "processing");
    try {
      const result = await window.cads.image.upload({
        filePath,
        assetId: asset.asset_id,
        suggestedFilename: asset.suggested_filename,
        imageSubject: asset.image_subject,
      });
      store.setRowVariants(asset.asset_id, {
        original: result.original,
        nobg: result.nobg,
        bgBlur: result.bgBlur,
      });
    } catch (err) {
      store.setRowError(asset.asset_id, (err as Error).message);
    }
  }

  const status = row?.status ?? "pending";
  const usedIn = asset.used_in.length;

  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "var(--space-md)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)" }}>
        <span style={{ fontSize: 18 }}>{statusGlyph(status)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {asset.purpose}
            {asset.optional && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  color: "var(--text-tertiary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "1px 5px",
                }}
              >
                OPTIONAL
              </span>
            )}
          </div>
          <div style={{ fontSize: "var(--font-size-caption)", color: "var(--text-tertiary)" }}>
            Saves as: {asset.suggested_filename} · Used in {usedIn} overlay{usedIn === 1 ? "" : "s"}
          </div>

          {status === "processing" && row?.progress && (
            <div style={{ marginTop: "var(--space-sm)" }}>
              <ProgressBar percent={row.progress.percent} />
              <div style={{ fontSize: "var(--font-size-caption)", color: "var(--accent-blue)" }}>
                {row.progress.stage}… {row.progress.percent}%
              </div>
            </div>
          )}

          {status === "processing" && !row?.progress && (
            <div style={{ marginTop: 6, fontSize: "var(--font-size-caption)", color: "var(--accent-blue)" }}>
              ⟳ Processing…
            </div>
          )}

          {status === "done" && row?.variants && (
            <div style={{ marginTop: "var(--space-sm)", display: "flex", gap: "var(--space-sm)" }}>
              <Thumb label="original" path={row.variants.original} />
              <Thumb label="no bg" path={row.variants.nobg} />
              <Thumb label="bokeh" path={row.variants.bgBlur} />
            </div>
          )}

          {status === "error" && (
            <div style={{ marginTop: "var(--space-sm)" }}>
              <p style={{ color: "#ff6b6b", fontSize: "var(--font-size-caption)", margin: "0 0 6px" }}>
                {row?.error}
              </p>
              <button type="button" onClick={pick} style={btn}>
                Retry
              </button>
            </div>
          )}
        </div>

        {(status === "pending" || status === "error") && (
          <button type="button" onClick={pick} style={btn}>
            Upload image ↑
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.heic"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
    </div>
  );
}

function statusGlyph(status: string): string {
  switch (status) {
    case "done":
      return "✓";
    case "processing":
    case "uploading":
      return "⟳";
    case "error":
      return "⚠";
    default:
      return "○";
  }
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div style={{ height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
      <div style={{ width: `${percent}%`, height: "100%", background: "var(--accent-blue)" }} />
    </div>
  );
}

function Thumb({ label, path }: { label: string; path: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 72,
          height: 54,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
          background: "repeating-conic-gradient(var(--surface) 0% 25%, var(--surface2) 0% 50%) 50% / 10px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img src={assetUrl(path)} alt={label} style={{ maxWidth: "100%", maxHeight: "100%" }} />
      </div>
      <span style={{ fontSize: 9, color: "var(--text-tertiary)" }}>{label}</span>
    </div>
  );
}

const btn: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
