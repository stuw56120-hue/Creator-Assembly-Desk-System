/*
 * C.A.D.S. motion graphic build pipeline (pure / dependency-injected).
 *
 * Renders a parameterised composition to a WebM (alpha) via the bundled
 * Hyperframes CLI, copies it into the Asset Library, and generates a first-frame
 * thumbnail with FFmpeg. All I/O (filesystem + subprocess) is injected so this
 * module is fully unit-testable and carries no Node/Electron/DOM dependency.
 *
 * The Electron handler (electron/ipc/motionGraphicsHandlers.ts) wires the real
 * implementations (node:fs/promises, child_process, node:path).
 */

import { getTemplate, validateParams } from "./templateRegistry";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface PipelineDeps {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  copyFile: (from: string, to: string) => Promise<void>;
  /** Byte size of a file; rejects if it does not exist. */
  fileSize: (path: string) => Promise<number>;
  ensureDir: (path: string) => Promise<void>;
  /** Spawn a command. Should reject if the binary cannot be launched. */
  runCommand: (cmd: string, args: string[]) => Promise<CommandResult>;
  join: (...parts: string[]) => string;
  /** Monotonic-ish token for unique temp filenames. */
  now: () => number;
}

export interface BuildRequest {
  assetId: string;
  templateId: string;
  params: Record<string, unknown>;
  projectRoot: string; // composition paths are resolved relative to this
  tmpDir: string;
  libraryDir: string; // …/library/motion_graphics
  hyperframesBin?: string; // default "hyperframes"
  ffmpegBin?: string; // default "ffmpeg"
}

export interface BuildResult {
  assetId: string;
  assetPath: string;
  thumbnailPath?: string;
  durationSeconds: number;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Substitute template tokens with validated params:
 *  - {{params_json}} → the full param object as JSON (read by the GSAP script)
 *  - {{fps}}         → frame rate (default 30)
 *  - {{key}}         → HTML-escaped string value of each param
 * Any leftover {{token}} (param not supplied) collapses to an empty string.
 */
export function parameteriseComposition(html: string, params: Record<string, unknown>): string {
  let out = html.split("{{params_json}}").join(JSON.stringify(params));
  out = out.split("{{fps}}").join(String(params.fps ?? 30));
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{{${key}}}`).join(escapeHtml(String(value ?? "")));
  }
  return out.replace(/\{\{[a-z0-9_]+\}\}/gi, "");
}

/** Render a composition to a WebM at `outPath`. @throws on a clean, descriptive error. */
async function renderComposition(
  req: BuildRequest,
  merged: Record<string, unknown>,
  outPath: string,
  deps: PipelineDeps,
): Promise<void> {
  const def = getTemplate(req.templateId);
  const compositionPath = deps.join(req.projectRoot, def.compositionPath);

  const html = await deps.readTextFile(compositionPath);
  const filled = parameteriseComposition(html, merged);

  // Hyperframes renders a PROJECT DIRECTORY (its positional arg), defaulting to
  // index.html — not a direct path to an HTML file (which fails with "Not a
  // directory"). So write the filled composition as index.html inside a fresh
  // temp project directory and hand Hyperframes that directory.
  const projectDir = deps.join(req.tmpDir, `mg-${req.assetId}-${deps.now()}`);
  await deps.ensureDir(projectDir);
  await deps.writeTextFile(deps.join(projectDir, "index.html"), filled);

  const bin = req.hyperframesBin ?? "hyperframes";
  let render: CommandResult;
  try {
    render = await deps.runCommand(bin, ["render", projectDir, "--output", outPath, "--format", "webm"]);
  } catch (err) {
    // ENOENT / spawn failure — bundled CLI missing or not launchable.
    throw new Error(
      `Hyperframes CLI ("${bin}") could not be launched. Is it bundled with the app? ` +
        `Underlying error: ${(err as Error).message}`,
    );
  }
  if (render.code !== 0) {
    throw new Error(
      `Hyperframes render failed (exit ${render.code}): ${render.stderr || render.stdout || "no output"}`,
    );
  }

  const size = await deps.fileSize(outPath).catch(() => 0);
  if (!size) {
    throw new Error("Hyperframes produced no output (WebM missing or empty).");
  }
}

function resolvedDuration(req: BuildRequest, merged: Record<string, unknown>): number {
  const def = getTemplate(req.templateId);
  const d = Number(merged.duration);
  return Number.isFinite(d) && d > 0 ? d : def.defaultDuration;
}

/**
 * Build a motion graphic: render → copy into the library → thumbnail.
 * Overwrites any existing asset with the same id (used by rebuild too).
 */
export async function buildMotionGraphic(
  req: BuildRequest,
  deps: PipelineDeps,
): Promise<BuildResult> {
  const { errors, merged } = validateParams(req.templateId, req.params);
  if (errors.length > 0) {
    throw new Error(`Invalid params for "${req.templateId}": ${errors.join("; ")}`);
  }

  const renderOut = deps.join(req.tmpDir, `mg-${req.assetId}-${deps.now()}.webm`);
  await renderComposition(req, merged, renderOut, deps);

  await deps.ensureDir(req.libraryDir);
  const assetPath = deps.join(req.libraryDir, `${req.assetId}.webm`);
  await deps.copyFile(renderOut, assetPath); // overwrites existing cache

  // Thumbnail (first frame). Non-fatal: a missing thumbnail must not fail a build.
  const thumbnailPath = deps.join(req.libraryDir, `${req.assetId}.thumb.png`);
  let thumbOk = false;
  try {
    const thumb = await deps.runCommand(req.ffmpegBin ?? "ffmpeg", [
      "-y",
      "-i",
      assetPath,
      "-vframes",
      "1",
      thumbnailPath,
    ]);
    thumbOk = thumb.code === 0;
  } catch {
    thumbOk = false;
  }

  return {
    assetId: req.assetId,
    assetPath,
    thumbnailPath: thumbOk ? thumbnailPath : undefined,
    durationSeconds: resolvedDuration(req, merged),
  };
}

/** Rebuild overwrites the existing cached WebM with current params. */
export async function rebuildMotionGraphic(
  req: BuildRequest,
  deps: PipelineDeps,
): Promise<BuildResult> {
  return buildMotionGraphic(req, deps);
}

/** Render to a temp file for live preview — no library copy, no thumbnail. */
export async function previewMotionGraphic(
  req: BuildRequest,
  deps: PipelineDeps,
): Promise<{ previewPath: string; durationSeconds: number }> {
  const { errors, merged } = validateParams(req.templateId, req.params);
  if (errors.length > 0) {
    throw new Error(`Invalid params for "${req.templateId}": ${errors.join("; ")}`);
  }
  const previewPath = deps.join(req.tmpDir, `preview-${req.assetId}-${deps.now()}.webm`);
  await renderComposition(req, merged, previewPath, deps);
  return { previewPath, durationSeconds: resolvedDuration(req, merged) };
}
