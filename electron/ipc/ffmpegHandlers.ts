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
import { mkdir, mkdtemp, stat, rename, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLongformRenderArgs,
  buildProxyRenderArgs,
  buildShortRenderArgs,
  buildShortsSegmentArgs,
  buildShortStillsArgs,
  buildSrtContent,
  mapCaptionsForLongform,
  mapCaptionsForShort,
  outputDuration,
  type KeepSegmentLike,
  type RenderOverlayInput,
  type RenderTransitionInput,
  type ShortMgOverlay,
  type ShortSegmentRenderInput,
} from "../../src/project/renderExporter";
import { buildShortsCaptions, parseVttWords, type VttWord } from "../../src/project/shortsCaptions";
import { lintShortRender, assDialogueSpans, assembledVisibleSpans } from "../../src/project/shortsLint";
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
  /** Presence of `segments` switches render:short to the Shorts Schema v2 path. */
  segments?: ShortSegmentIpc[];
}

/* ── Shorts Schema v2 render path (SS-6) ──────────────────────────────────── */

/** One assembled segment as it crosses the IPC boundary. */
interface ShortSegmentIpc {
  inSeconds: number;
  outSeconds: number;
  energy?: string;
  transitionIn?: string;
  transitionOut?: string;
  overlays?: ShortMgOverlay[];
  /** Words to highlight in this segment's captions. */
  emphasis?: string[];
}

interface ShortV2Args {
  sourcePath: string;
  segments: ShortSegmentIpc[];
  hookOverlay?: ShortMgOverlay;
  ctaOverlay?: ShortMgOverlay;
  /** Transcript VTT, parsed for caption word timing. */
  vttPath?: string;
  /** Pre-parsed caption words (used instead of vttPath if supplied). */
  captionWords?: VttWord[];
  captionStyle?: string;
  /** "proxy" (default) renders a 720p preview for approval; "full" renders 1080p + cover. */
  quality?: "proxy" | "full";
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  zoomPunchOnCut?: boolean;
  defaultName: string;
}

/** Escape a Windows path for use inside the FFmpeg `subtitles=filename='...'` filter. */
function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/**
 * Shorts Schema v2 render. Builds captions from the transcript, runs the
 * pre-render lint (blocks on plain-English errors), then renders either a 720p
 * preview proxy (default — user approves before committing) or the full 1080p
 * MP4 plus a per-segment contact sheet. Returns `{ blocked, errors }` when the
 * lint refuses the render — never throws for a lint failure.
 */
async function renderShortV2(
  event: IpcMainInvokeEvent,
  plan: ShortV2Args,
): Promise<
  | { canceled: true }
  | { canceled: false; blocked: true; errors: string[] }
  | { canceled: false; blocked?: false; quality: "proxy" | "full"; outputPath: string; contactSheet?: string; coverage: number }
> {
  const quality = plan.quality ?? "proxy";
  const frameWidth = quality === "proxy" ? 720 : 1080;
  const frameHeight = quality === "proxy" ? 1280 : 1920;

  // 1. Captions from the transcript words.
  let words = plan.captionWords;
  if (!words && plan.vttPath) {
    try {
      words = parseVttWords(await readFile(plan.vttPath, "utf8"));
    } catch (err) {
      console.warn(`[render:short v2] Could not read transcript ${plan.vttPath}: ${(err as Error).message} — rendering without captions.`);
      words = [];
    }
  }
  const ass = buildShortsCaptions({
    segments: plan.segments.map((s) => ({ inSeconds: s.inSeconds, outSeconds: s.outSeconds, emphasis: s.emphasis ?? [] })),
    words: words ?? [],
    captionStyle: plan.captionStyle ?? "shorts_bold",
    frameWidth,
    frameHeight,
  });

  // 2. Pre-render lint — block on plain-English errors before spending a render.
  const lint = lintShortRender({
    segments: plan.segments.map((s, i) => ({
      segmentId: `segment ${i + 1}`,
      inSeconds: s.inSeconds,
      outSeconds: s.outSeconds,
      overlays: (s.overlays ?? []).map((o) => ({ appearAtSeconds: o.appearAtSeconds, durationSeconds: o.durationSeconds })),
    })),
    visibleSpans: assembledVisibleSpans({
      segments: plan.segments,
      hook: plan.hookOverlay,
      cta: plan.ctaOverlay,
      captionSpans: assDialogueSpans(ass),
    }),
  });
  if (lint.errors.length > 0) {
    console.warn(`[render:short v2] Lint blocked the render:\n${lint.errors.join("\n")}`);
    return { canceled: false, blocked: true, errors: lint.errors };
  }

  const totalDuration = plan.segments.reduce((acc, s) => acc + Math.max(0, s.outSeconds - s.inSeconds), 0);
  const renderSegments: ShortSegmentRenderInput[] = plan.segments.map((s) => ({
    inSeconds: s.inSeconds,
    outSeconds: s.outSeconds,
    transitionIn: s.transitionIn ?? "cut",
    transitionOut: s.transitionOut ?? "cut",
    overlays: s.overlays ?? [],
    energy: s.energy,
  }));

  // 3. Resolve the output path. Proxy → cached preview location (no dialog);
  //    full → save dialog.
  let outputPath: string;
  if (quality === "proxy") {
    const dir = path.join(app.getPath("userData"), "proxies");
    await mkdir(dir, { recursive: true });
    outputPath = path.join(dir, `${path.parse(plan.defaultName).name}-shorts-proxy.mp4`);
  } else {
    const win = senderWindow(event);
    const save = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Render Short",
      defaultPath: plan.defaultName,
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    outputPath = save.filePath;
  }

  // 4. Assemble (segments + transitions + overlays + Ken Burns/fades/zoom-punch),
  //    then burn captions in a second pass. Both go through temp files so a
  //    killed render never leaves a truncated MP4 at the final path.
  const stamp = `${Date.now()}-${++__ffmpegRunCounter}`;
  const tmpAssembled = path.join(os.tmpdir(), `cads-shortv2-asm-${stamp}.mp4`);
  const tmpFinal = path.join(os.tmpdir(), `cads-shortv2-final-${stamp}.mp4`);
  const assFile = ass ? path.join(os.tmpdir(), `cads-shortv2-${stamp}.ass`) : null;
  try {
    const assembleArgs = buildShortsSegmentArgs({
      sourcePath: plan.sourcePath,
      segments: renderSegments,
      hookOverlay: plan.hookOverlay,
      ctaOverlay: plan.ctaOverlay,
      outputPath: tmpAssembled,
      proxy: quality === "proxy",
      fadeInSeconds: plan.fadeInSeconds ?? 0.3,
      fadeOutSeconds: plan.fadeOutSeconds ?? 0.5,
      zoomPunchOnCut: plan.zoomPunchOnCut ?? true,
    });
    const spilled = await spillLargeFilterComplex(assembleArgs);
    await runFfmpeg(spilled.args, totalDuration, (percent) =>
      event.sender.send("render:progress", { phase: "short", percent: Math.round(percent * 0.85) }),
    );
    if (spilled.cleanupFile) await rm(path.dirname(spilled.cleanupFile), { recursive: true, force: true }).catch(() => {});

    if (assFile) {
      await writeFile(assFile, ass, "utf8");
      await runFfmpeg(
        ["-i", tmpAssembled, "-vf", `subtitles=filename='${escapeSubtitlesPath(assFile)}'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-y", tmpFinal],
        totalDuration,
        (percent) => event.sender.send("render:progress", { phase: "short", percent: 85 + Math.round(percent * 0.15) }),
      );
    } else {
      await rename(tmpAssembled, tmpFinal);
    }
    await rename(tmpFinal, outputPath);

    // 5. Full render → per-segment contact sheet alongside the MP4.
    let contactSheet: string | undefined;
    if (quality === "full") {
      contactSheet = outputPath.replace(/\.mp4$/i, "") + "_contact.png";
      try {
        await runFfmpeg(
          buildShortStillsArgs({ sourcePath: plan.sourcePath, segments: plan.segments.map((s) => ({ inSeconds: s.inSeconds, outSeconds: s.outSeconds })), outputPath: contactSheet }),
          0,
          () => {},
        );
      } catch (err) {
        console.warn(`[render:short v2] Contact sheet failed (not fatal): ${(err as Error).message}`);
        contactSheet = undefined;
      }
    }
    event.sender.send("render:progress", { phase: "short", percent: 100 });
    return { canceled: false, quality, outputPath, contactSheet, coverage: lint.coverage };
  } finally {
    await rm(tmpAssembled, { force: true }).catch(() => {});
    await rm(tmpFinal, { force: true }).catch(() => {});
    if (assFile) await rm(assFile, { force: true }).catch(() => {});
  }
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
    // Shorts Schema v2: a short carrying segments[] uses the assembled multi-
    // segment path (captions + lint + proxy-first + contact sheet). A short
    // without segments falls back to the v1 single-clip path below.
    if (Array.isArray(plan.segments) && plan.segments.length > 0) {
      return renderShortV2(event, plan as unknown as ShortV2Args);
    }

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
        // Defensive: a v2 plan (segments[], no top-level overlays) is routed to
        // renderShortV2 above, so this path only ever sees real v1 plans — but
        // never let a missing overlays array throw "not iterable".
        overlays: plan.overlays ?? [],
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
