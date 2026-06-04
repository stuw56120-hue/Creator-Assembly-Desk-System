/*
 * First-time model download banner. Shown until the local u2net background-
 * removal model is present. Downloading it is a one-time, ~170MB fetch; after
 * that the banner never appears again on this machine.
 */

import { useEffect, useState } from "react";
import { useOnboardingStore } from "./onboardingStore";

export function ModelDownloadBanner() {
  const modelReady = useOnboardingStore((s) => s.modelReady);
  const setModelReady = useOnboardingStore((s) => s.setModelReady);
  const [downloading, setDownloading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!downloading) return;
    return window.cads?.image?.onUploadProgress((data) => {
      if (data.assetId === "__model__") setStage(data.stage);
    });
  }, [downloading]);

  if (modelReady) return null;

  async function onDownload() {
    setDownloading(true);
    setError("");
    try {
      await window.cads.image.downloadModel();
      setModelReady(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--accent-blue-border)",
        background: "var(--accent-blue-light)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-md)",
        marginBottom: "var(--space-lg)",
      }}
    >
      <strong>First-time setup</strong>
      <p style={{ margin: "4px 0 var(--space-sm)", color: "var(--text-secondary)", fontSize: "var(--font-size-body-sm)" }}>
        C.A.D.S. needs to download a ~170MB AI model for background removal. This happens once only,
        and runs entirely on your machine.
      </p>
      {downloading ? (
        <div style={{ fontSize: "var(--font-size-caption)", color: "var(--accent-blue)" }}>
          ⟳ {stage || "Downloading u2net.onnx…"}
        </div>
      ) : (
        <button type="button" onClick={onDownload} className="btn-primary">
          Download AI model (170MB, one-time)
        </button>
      )}
      {error && (
        <p style={{ color: "#ff6b6b", fontSize: "var(--font-size-caption)", marginTop: 6 }}>{error}</p>
      )}
    </div>
  );
}
