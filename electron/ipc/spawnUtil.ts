/*
 * Small subprocess helper shared by the ingest/transcribe handlers. Streams
 * stderr line-by-line (workers emit progress there), accumulates stdout, and
 * resolves on a clean exit / rejects with the tail of stderr otherwise.
 */

import { spawn } from "node:child_process";

export interface SpawnResult {
  stdout: string;
  stderr: string;
}

/**
 * Environment for Python workers that use the HuggingFace hub (faster-whisper).
 * On Windows the hub creates symlinks by default, which require Developer Mode
 * or admin (WinError 1314). Disabling symlinks makes it copy files instead, so
 * model downloads work for a non-elevated user out of the box.
 */
export const PYTHON_WORKER_ENV: NodeJS.ProcessEnv = {
  HF_HUB_DISABLE_SYMLINKS: "1",
  HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
};

export function spawnStreaming(
  bin: string,
  args: string[],
  onStderrLine: (line: string) => void,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    let buffer = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onStderrLine(line.trim());
    });

    child.on("error", (err) => reject(new Error(`Failed to start "${bin}": ${err.message}`)));
    child.on("close", (code) => {
      if (buffer.trim()) onStderrLine(buffer.trim());
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().split(/\r?\n/).slice(-4).join("\n") || `"${bin}" exited ${code}`));
    });
  });
}
