/*
 * Auto-generates the playback proxy for the editor.
 *
 * The centre preview plays a downscaled proxy (never the full-res source). This
 * hook kicks that render off automatically once a project with a real source
 * video is loaded, streams progress, and hands back the proxy path when ready.
 * The main process reuses an existing proxy, so re-opening a project is cheap.
 */

import { useEffect, useState } from "react";

export interface ProxyState {
  proxyPath: string | null;
  generating: boolean;
  percent: number;
  error: string | null;
}

// De-dupe concurrent/duplicate requests for the same source (StrictMode, HMR,
// re-renders, and an early kick-off from the Video Source step) so we never
// launch two FFmpeg passes for one video.
const inFlight = new Map<string, Promise<string>>();

/**
 * Start generating the proxy for a source video (idempotent). Safe to call the
 * moment the user confirms the source — the work then runs in the background and
 * any later useProxy() for the same source attaches to the same render. Returns
 * the shared promise, or null when there's nothing to generate.
 */
export function startProxyGeneration(
  sourceVideoPath: string,
  durationSeconds: number,
): Promise<string> | null {
  if (!sourceVideoPath || !window.cads?.render?.proxy) return null;
  let promise = inFlight.get(sourceVideoPath);
  if (!promise) {
    promise = window.cads.render
      .proxy({ sourcePath: sourceVideoPath, durationSeconds })
      .then((r) => r.outputPath);
    inFlight.set(sourceVideoPath, promise);
    // Drop the cache entry once settled so a later mount can re-check disk.
    void promise.finally(() => inFlight.delete(sourceVideoPath));
  }
  return promise;
}

export function useProxy(sourceVideoPath: string, durationSeconds: number): ProxyState {
  const [state, setState] = useState<ProxyState>({
    proxyPath: null,
    generating: false,
    percent: 0,
    error: null,
  });

  useEffect(() => {
    const promise = startProxyGeneration(sourceVideoPath, durationSeconds);
    if (!promise) {
      setState({ proxyPath: null, generating: false, percent: 0, error: null });
      return;
    }

    let cancelled = false;
    setState({ proxyPath: null, generating: true, percent: 0, error: null });

    const unsub = window.cads.render.onProgress((d) => {
      if (!cancelled && d.phase === "proxy") {
        setState((s) => (s.generating ? { ...s, percent: d.percent } : s));
      }
    });

    promise
      .then((outputPath) => {
        if (!cancelled) setState({ proxyPath: outputPath, generating: false, percent: 100, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            proxyPath: null,
            generating: false,
            percent: 0,
            error:
              (err as Error)?.message ??
              "Couldn't build the video preview. Check that the source video is reachable.",
          });
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [sourceVideoPath, durationSeconds]);

  return state;
}
