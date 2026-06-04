/*
 * Electron IPC — FFmpeg render pipeline.
 *
 * Wires the pure renderExporter (src/project/renderExporter.ts) to FFmpeg:
 *   render:longform  → cuts applied + motion graphics composited → MP4
 *   render:short     → vertical 9:16 clip with overlays → MP4
 *   render:proxy     → downscaled preview source (never the full-res original)
 *   render:thumbnail → single frame
 * Progress (parsed from FFmpeg's "time=") is streamed via "render:progress".
 */

import { ipcMain, dialog, BrowserWindow, app, type IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, stat, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLongformRenderArgs,
  buildProxyRenderArgs,
  buildShortRenderArgs,
  buildSrtContent,
  mapCaptionsForLongform,
  mapCaptionsForShort,
  outputDuration,
  type KeepSegmentLike,
  type RenderOverlayInput,
  type RenderTransitionInput,
} from "../../src/project/renderExporter";
import { buildAssContent, partitionCaptionsByStyle } from "../../src/project/assBuilder";
import { getFfmpegPreset } from "../../src/config/presets";
import {
  findRealFfmpegError,
  formatFfmpegCommand,
  tailStderrLines,
} from "../../src/render/ffmpegErrors";

const FFMPEG_BIN = process.env.CADS_FFMPEG_BIN ?? "ffmpeg";
const FFPROBE_BIN = process.env.CADS_FFPROBE_BIN ?? "ffprobe";

/** Probe the source video's pixel dimensions; falls back to 1920×1080. */
function probeVideoSize(sourcePath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const child = spawn(
      FFPROBE_BIN,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", sourcePath],
      { windowsHide: true },
    );
    let out = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.on("error", () => resolve({ width: 1920, height: 1080 }));
    child.on("close", () => {
      const m = /(\d+)\s*x\s*(\d+)/.exec(out.trim());
      resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1080 });
    });
  });
}

/** A caption as it crosses the IPC boundary — raw text + source time. */
interface CaptionIpcInput {
  sourceStart: number;
  duration: number;
  text: string;
}

/**
 * Pre-map captions to OUTPUT time, partition by style, and write the
 * appropriate subtitle files in TEMP:
 *   • non-karaoke captions → `cads-caps-{ts}.srt`  (existing SRT path)
 *   • karaoke_highlight    → `cads-caps-{ts}.ass`  (libass `{\k}` tags;
 *                            even-split per-word timing — see assBuilder.ts)
 *
 * Returns either path as `null` when its bucket is empty so the caller skips
 * the matching filter and the temp cleanup. Today every caption shares the
 * project's captionStyle so only one bucket is ever populated, but the
 * partition is shaped to support a future per-caption style override.
 */
async function writeCaptionFiles(
  captions: CaptionIpcInput[],
  projectStyle: string | undefined,
  mode:
    | { kind: "longform"; keepSegments: KeepSegmentLike[] }
    | { kind: "short"; inSeconds: number; outSeconds: number },
  assFrame: { width: number; height: number },
): Promise<{ srtPath: string | null; assPath: string | null }> {
  if (captions.length === 0) {
    console.log(`[render:${mode.kind}] No captions in range — skipping subtitles filter.`);
    return { srtPath: null, assPath: null };
  }
  const mapped =
    mode.kind === "longform"
      ? mapCaptionsForLongform(captions, mode.keepSegments)
      : mapCaptionsForShort(captions, mode.inSeconds, mode.outSeconds);
  const { ass, srt } = partitionCaptionsByStyle(mapped, projectStyle);

  // SRT side — non-karaoke. Unchanged behaviour.
  let srtPath: string | null = null;
  if (srt.length > 0) {
    const content = buildSrtContent(srt);
    if (content) {
      srtPath = path.join(os.tmpdir(), `cads-caps-${Date.now()}.srt`);
      await writeFile(srtPath, content, "utf8");
      console.log(`[render:${mode.kind}] Wrote SRT (${srt.length} cues) → ${srtPath}`);
    }
  }

  // ASS side — karaoke_highlight. Word-level timestamps are not produced by
  // Whisper-small in this pipeline (see PreviewOverlays.tsx "No word-level
  // timing from the transcript yet"), so per-word \k values are evenly split
  // across each caption's duration. Flag the approximation once per render.
  let assPath: string | null = null;
  if (ass.length > 0) {
    console.log(
      `[render:${mode.kind}] Karaoke captions: approximating per-word timing by even split (no word-level timestamps from Whisper).`,
    );
    const content = buildAssContent(ass, assFrame);
    if (content) {
      assPath = path.join(os.tmpdir(), `cads-caps-${Date.now() + 1}.ass`);
      await writeFile(assPath, content, "utf8");
      console.log(`[render:${mode.kind}] Wrote ASS (${ass.length} cues) → ${assPath}`);
    }
  }

  if (!srtPath && !assPath) {
    console.log(`[render:${mode.kind}] No captions in range — skipping subtitles filter.`);
  }
  return { srtPath, assPath };
}

/** Delete temp caption files after a render. Logs on success/failure; never throws. */
async function cleanupCaptionFiles(paths: (string | null)[]): Promise<void> {
  for (const p of paths) {
    if (!p) continue;
    try {
      await rm(p, { force: true });
      console.log(`[render] Deleted ${p}`);
    } catch (err) {
      console.warn(`[render] Failed to delete ${p}: ${(err as Error).message} (not fatal)`);
    }
  }
}

/**
 * When the filter graph is large (many captions / overlays), the inline
 * `-filter_complex <string>` arg can blow past Windows' 32 KB command-line cap
 * and spawn fails with ENAMETOOLONG. Spill any large value to a temp file and
 * swap to `-filter_complex_script` (FFmpeg reads the graph from the file).
 * Returns the swapped args plus an optional cleanup path.
 */
async function spillLargeFilterComplex(
  args: string[],
): Promise<{ args: string[]; cleanupFile: string | null }> {
  const i = args.indexOf("-filter_complex");
  if (i < 0 || i + 1 >= args.length) return { args, cleanupFile: null };
  const value = args[i + 1];
  if (value.length < 4000) return { args, cleanupFile: null }; // small → leave inline
  const dir = await mkdtemp(path.join(os.tmpdir(), "cads-fc-"));
  const file = path.join(dir, "filter_complex.txt");
  await writeFile(file, value, "utf8");
  const next = args.slice();
  next.splice(i, 2, "-filter_complex_script", file);
  return { args: next, cleanupFile: file };
}

/** Parse "time=HH:MM:SS.ss" from an FFmpeg stderr chunk into seconds. */
function parseFfmpegTime(text: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Monotonic counter for run ids, so two concurrent renders' logs don't blur. */
let __ffmpegRunCounter = 0;

function runFfmpeg(
  args: string[],
  totalDuration: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const runId = ++__ffmpegRunCounter;
    // Log the FULL command line before invocation — permanent, on every run.
    // initLogging() patches console.log → writeLog INFO, so this lands in
    // logs/cads-YYYY-MM-DD.log automatically.
    console.log(`[ffmpeg run#${runId}] ${formatFfmpegCommand(FFMPEG_BIN, args)}`);
    const child = spawn(FFMPEG_BIN, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      const t = parseFfmpegTime(text);
      if (t != null && totalDuration > 0) {
        onProgress(Math.min(100, Math.round((t / totalDuration) * 100)));
      }
    });
    child.on("error", (err) => {
      console.error(`[ffmpeg run#${runId}] spawn failed: ${err.message}`);
      reject(new Error(`Failed to start FFmpeg ("${FFMPEG_BIN}"): ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        onProgress(100);
        resolve();
        return;
      }
      // Non-zero exit. Dump the FULL stderr to the log under a clear marker
      // (multi-line — appears as one entry with embedded newlines, readable
      // via Get-Content). Then build a richer IPC error: the real error line
      // (heuristic) + the last 40 non-empty stderr lines, so the renderer
      // surfaces something diagnostic instead of the codec-stats tail.
      const realErr = findRealFfmpegError(stderr);
      const tail = tailStderrLines(stderr, 40);
      console.error(
        `[ffmpeg run#${runId}] FFMPEG-STDERR-FULL exit=${code}\n` +
          `---- command ----\n${formatFfmpegCommand(FFMPEG_BIN, args)}\n` +
          `---- stderr ----\n${stderr}\n---- end ----`,
      );
      const header = realErr
        ? `FFmpeg failed (exit ${code}): ${realErr}`
        : `FFmpeg failed (exit ${code}).`;
      const body = tail || `(no stderr captured) FFmpeg exited ${code}`;
      reject(new Error(`${header}\n\nLast 40 stderr lines:\n${body}`));
    });
  });
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

interface LongformArgs {
  sourcePath: string;
  keepSegments: KeepSegmentLike[];
  overlays: RenderOverlayInput[];
  transitions?: RenderTransitionInput[];
  captions?: CaptionIpcInput[];
  captionStyle?: string;
  defaultName: string;
}

interface ShortArgs {
  sourcePath: string;
  inSeconds: number;
  outSeconds: number;
  overlays: RenderOverlayInput[];
  captions?: CaptionIpcInput[];
  captionStyle?: string;
  defaultName: string;
}

export function registerFfmpegHandlers(): void {
  ipcMain.handle("render:longform", async (event, plan: LongformArgs) => {
    const win = senderWindow(event);
    const save = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Render Long-Form Video",
      defaultPath: plan.defaultName,
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };

    const size = await probeVideoSize(plan.sourcePath);
    const { srtPath, assPath } = await writeCaptionFiles(
      plan.captions ?? [],
      plan.captionStyle,
      { kind: "longform", keepSegments: plan.keepSegments },
      { width: size.width, height: size.height },
    );
    let fcCleanup: string | null = null;
    try {
      const rawArgs = buildLongformRenderArgs({
        sourcePath: plan.sourcePath,
        keepSegments: plan.keepSegments,
        overlays: plan.overlays,
        transitions: plan.transitions,
        subtitlesFilePath: srtPath ?? undefined,
        assFilePath: assPath ?? undefined,
        captionStyle: plan.captionStyle,
        outputPath: save.filePath,
        preset: getFfmpegPreset("longform"),
        frameWidth: size.width,
        frameHeight: size.height,
      });
      const spilled = await spillLargeFilterComplex(rawArgs);
      fcCleanup = spilled.cleanupFile;
      try {
        await runFfmpeg(spilled.args, outputDuration(plan.keepSegments), (percent) =>
          event.sender.send("render:progress", { phase: "longform", percent }),
        );
      } catch (err) {
        if (srtPath || assPath) {
          console.error(
            `[render:longform] FFmpeg failed (caption files: srt=${srtPath ?? "—"} ass=${assPath ?? "—"}): ${(err as Error).message}`,
          );
        }
        throw err;
      }
      return { canceled: false, outputPath: save.filePath };
    } finally {
      await cleanupCaptionFiles([srtPath, assPath]);
      if (fcCleanup) await rm(path.dirname(fcCleanup), { recursive: true, force: true }).catch(() => {});
    }
  });

  ipcMain.handle("render:short", async (event, plan: ShortArgs) => {
    const win = senderWindow(event);
    const save = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Render Short",
      defaultPath: plan.defaultName,
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };

    const { srtPath, assPath } = await writeCaptionFiles(
      plan.captions ?? [],
      plan.captionStyle,
      { kind: "short", inSeconds: plan.inSeconds, outSeconds: plan.outSeconds },
      { width: 1080, height: 1920 },
    );
    let fcCleanup: string | null = null;
    try {
      const rawArgs = buildShortRenderArgs({
        sourcePath: plan.sourcePath,
        inSeconds: plan.inSeconds,
        outSeconds: plan.outSeconds,
        overlays: plan.overlays,
        subtitlesFilePath: srtPath ?? undefined,
        assFilePath: assPath ?? undefined,
        captionStyle: plan.captionStyle,
        outputPath: save.filePath,
        preset: getFfmpegPreset("short"),
        frameWidth: 1080,
        frameHeight: 1920,
      });
      const spilled = await spillLargeFilterComplex(rawArgs);
      fcCleanup = spilled.cleanupFile;
      try {
        await runFfmpeg(spilled.args, plan.outSeconds - plan.inSeconds, (percent) =>
          event.sender.send("render:progress", { phase: "short", percent }),
        );
      } catch (err) {
        if (srtPath || assPath) {
          console.error(
            `[render:short] FFmpeg failed (caption files: srt=${srtPath ?? "—"} ass=${assPath ?? "—"}): ${(err as Error).message}`,
          );
        }
        throw err;
      }
      return { canceled: false, outputPath: save.filePath };
    } finally {
      await cleanupCaptionFiles([srtPath, assPath]);
      if (fcCleanup) await rm(path.dirname(fcCleanup), { recursive: true, force: true }).catch(() => {});
    }
  });

  ipcMain.handle(
    "render:proxy",
    async (event, args: { sourcePath: string; durationSeconds: number }) => {
      const proxyDir = path.join(app.getPath("userData"), "proxies");
      await mkdir(proxyDir, { recursive: true });
      const outputPath = path.join(proxyDir, `${path.parse(args.sourcePath).name}-proxy.mp4`);
      // A finished proxy only ever exists at the final path (we render to a temp
      // file and rename on success), so its presence means it's complete and
      // reusable — the auto-run on every editor open must be cheap.
      try {
        const s = await stat(outputPath);
        if (s.size > 0) {
          event.sender.send("render:progress", { phase: "proxy", percent: 100 });
          return { outputPath, cached: true };
        }
      } catch {
        /* no proxy yet — render it below */
      }
      // Render to a temp file and rename atomically. If FFmpeg is killed
      // mid-render (e.g. app quit), only the temp file is left behind — never a
      // truncated MP4 masquerading as a valid cached proxy.
      const tmpPath = path.join(proxyDir, `.${path.parse(args.sourcePath).name}-proxy.${Date.now()}.tmp.mp4`);
      try {
        await runFfmpeg(buildProxyRenderArgs(args.sourcePath, tmpPath), args.durationSeconds, (percent) =>
          event.sender.send("render:progress", { phase: "proxy", percent }),
        );
        await rename(tmpPath, outputPath);
      } catch (err) {
        await rm(tmpPath, { force: true }); // drop the partial file
        throw err;
      }
      return { outputPath, cached: false };
    },
  );

  ipcMain.handle(
    "render:thumbnail",
    async (_event, args: { sourcePath: string; time: number; outputPath: string }) => {
      await runFfmpeg(
        ["-ss", String(args.time), "-i", args.sourcePath, "-vframes", "1", "-y", args.outputPath],
        0,
        () => {},
      );
      return { outputPath: args.outputPath };
    },
  );
}
