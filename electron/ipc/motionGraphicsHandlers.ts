/*
 * Electron IPC — motion graphics build pipeline.
 *
 * Wires the pure buildPipeline (src/motionGraphics/buildPipeline.ts) to real
 * Node I/O: filesystem via fs/promises, subprocess via child_process.spawn,
 * paths via node:path. Registers the build / rebuild / preview channels and
 * keeps library_index.json up to date.
 */

import { ipcMain, app } from "electron";
import { spawn } from "node:child_process";
import { readFile, writeFile, copyFile, stat, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  buildMotionGraphic,
  previewMotionGraphic,
  rebuildMotionGraphic,
  type BuildRequest,
  type CommandResult,
  type PipelineDeps,
} from "../../src/motionGraphics/buildPipeline";
import { resolveLibraryRoot } from "./libraryPaths";
import { resolveBackgroundAbsolutePath } from "./mgBackgroundHandlers";
import {
  ALLOWED_BG_FITS,
  DEFAULT_BG_FIT,
  DEFAULT_BG_OPACITY,
  clampBackgroundOpacity,
} from "../../src/motionGraphics/backgroundAssets";
import { isBackgroundEligible } from "../../src/motionGraphics/backgroundEligibility";
import { writeLog as bgWriteLog } from "../logger";

const FFMPEG_BIN = process.env.CADS_FFMPEG_BIN ?? "ffmpeg";

/**
 * Locate the Hyperframes CLI bundled in node_modules (never on the system PATH —
 * users never install it themselves). Returns the absolute path to its bin
 * script (dist/cli.js), which we run with a Node runtime, or null if it somehow
 * isn't installed.
 */
function resolveHyperframesCli(): string | null {
  // 1) Resolve via the package's own bin entry (works in dev and when packaged).
  try {
    const req = createRequire(__filename);
    const pkgJsonPath = req.resolve("hyperframes/package.json");
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
    const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.hyperframes;
    if (binRel) {
      const abs = path.join(path.dirname(pkgJsonPath), binRel);
      if (existsSync(abs)) return abs;
    }
  } catch {
    /* fall through to the path guess */
  }
  // 2) Fallback: the conventional location under the app's node_modules.
  const guess = path.join(app.getAppPath(), "node_modules", "hyperframes", "dist", "cli.js");
  return existsSync(guess) ? guess : null;
}

/**
 * The Hyperframes command for a build request. An explicit CADS_HYPERFRAMES_BIN
 * wins (escape hatch); otherwise the bundled CLI script; final fallback is the
 * bare name (which yields a clean "couldn't launch" message if truly absent).
 */
function hyperframesCommand(): string {
  return process.env.CADS_HYPERFRAMES_BIN ?? resolveHyperframesCli() ?? "hyperframes";
}

let uniqueCounter = 0;

/** Plain-English message (for Stuart, not a stack trace) when a tool can't be launched. */
function missingToolError(cmd: string): Error {
  if (cmd === FFMPEG_BIN) {
    return new Error(
      "FFmpeg isn’t installed or can’t be found. FFmpeg is the free tool C.A.D.S. uses to process " +
        "video and audio.\n\nInstall it (in PowerShell: winget install Gyan.FFmpeg) or from " +
        "https://ffmpeg.org/download.html, then reopen C.A.D.S.",
    );
  }
  if (cmd === "hyperframes") {
    // Only reached if the bundled CLI couldn't be resolved from node_modules.
    return new Error(
      "C.A.D.S. couldn’t start its built-in motion-graphics renderer (Hyperframes). " +
        "This usually means the app’s files are incomplete — try reinstalling C.A.D.S.",
    );
  }
  return new Error(`Couldn’t run “${cmd}” — it may not be available.`);
}

interface SpawnPlan {
  exec: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Ordered ways to launch a command. A bundled .js CLI (Hyperframes) is run with
 * a Node runtime — never relying on the script being executable or globally
 * installed: prefer system Node (Hyperframes needs Node ≥22), and fall back to
 * this Electron binary in Node mode, so nothing external is ever required.
 */
function spawnPlans(cmd: string, args: string[]): SpawnPlan[] {
  if (!cmd.endsWith(".js")) return [{ exec: cmd, args, env: process.env }];
  return [
    { exec: process.env.CADS_NODE_BIN ?? "node", args: [cmd, ...args], env: process.env },
    {
      exec: process.execPath,
      args: [cmd, ...args],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  ];
}

function spawnCollectPlan(plan: SpawnPlan, friendlyFor: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.exec, plan.args, { windowsHide: true, env: plan.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      reject((err as NodeJS.ErrnoException).code === "ENOENT" ? missingToolError(friendlyFor) : err),
    );
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  const plans = spawnPlans(cmd, args);
  for (let i = 0; i < plans.length; i++) {
    try {
      return await spawnCollectPlan(plans[i], cmd);
    } catch (err) {
      const isEnoent = (err as NodeJS.ErrnoException).code === "ENOENT" || /Couldn’t run/.test((err as Error).message);
      if (isEnoent && i < plans.length - 1) continue; // try the next runtime
      throw err;
    }
  }
  throw missingToolError(cmd);
}

const ANSI_RE = /\[[0-9;?]*[A-Za-z]/g;

/**
 * Run a command, streaming cleaned (ANSI-stripped) non-empty output lines to
 * `onLine`. Used for the one-time browser download so CADS can show progress.
 * Resolves with the exit code.
 */
function runCommandStreaming(
  cmd: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<number> {
  const plans = spawnPlans(cmd, args);
  const tryPlan = (i: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const child = spawn(plans[i].exec, plans[i].args, { windowsHide: true, env: plans[i].env });
      const emit = (buf: Buffer) => {
        for (const raw of buf.toString().replace(ANSI_RE, "").split(/\r?\n/)) {
          const line = raw.trim();
          if (line) onLine(line);
        }
      };
      child.stdout?.on("data", emit);
      child.stderr?.on("data", emit);
      child.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT" && i < plans.length - 1) {
          tryPlan(i + 1).then(resolve, reject);
        } else {
          reject((err as NodeJS.ErrnoException).code === "ENOENT" ? missingToolError(cmd) : err);
        }
      });
      child.on("close", (code) => resolve(code ?? -1));
    });
  return tryPlan(0);
}

function makeDeps(): PipelineDeps {
  return {
    readTextFile: (p) => readFile(p, "utf8"),
    writeTextFile: (p, c) => writeFile(p, c, "utf8"),
    copyFile: (from, to) => copyFile(from, to),
    fileSize: async (p) => (await stat(p)).size,
    ensureDir: async (p) => {
      await mkdir(p, { recursive: true });
    },
    runCommand,
    join: path.join,
    now: () => Date.now() * 1000 + (uniqueCounter++ % 1000),
  };
}

/** Where compositions/ lives (project root in dev, app resources when packaged). */
function projectRoot(): string {
  return app.getAppPath();
}

interface LibraryContext {
  /** …/library — defaults to userData/library when not provided by the project. */
  libraryRoot: string;
}

async function libraryContext(): Promise<LibraryContext> {
  return { libraryRoot: await resolveLibraryRoot() };
}

function baseRequest(
  ctx: LibraryContext,
  assetId: string,
  templateId: string,
  params: Record<string, unknown>,
): BuildRequest {
  return {
    assetId,
    templateId,
    params,
    projectRoot: projectRoot(),
    tmpDir: app.getPath("temp"),
    libraryDir: path.join(ctx.libraryRoot, "motion_graphics"),
    hyperframesBin: hyperframesCommand(),
    ffmpegBin: FFMPEG_BIN,
  };
}

interface LibraryIndexAsset {
  id: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  category: "motion_graphic";
  thumbnailPath?: string;
  hasAlpha: boolean;
  tags: string[];
  addedAt: string;
  usageCount: number;
  templateId: string;
  params: Record<string, unknown>;
  durationSeconds: number;
}

interface AssetGroupRecord {
  asset_group_id: string;
  asset_id: string;
  variants: { original: string; nobg: string; bg_blur: string };
}

/** Absolute OS path → file:// URL the Hyperframes render browser can load. */
function toFileUrl(absolutePath: string): string {
  const normalised = absolutePath.replace(/\\/g, "/");
  return normalised.startsWith("/") ? `file://${normalised}` : `file:///${normalised}`;
}

function looksLikePathOrUrl(value: unknown): value is string {
  return typeof value === "string" && (/[\\/]/.test(value) || /^(file|https?):/i.test(value));
}

/**
 * Resolve an image reference (params.asset_id, or params.image when it's an id
 * rather than a path) to a concrete file:// URL from the Asset Library — by a
 * direct asset id, or by a required-asset group id (preferring the `original`
 * variant). Leaves params untouched if nothing resolves, so compositions fall
 * back gracefully. Used by meme_pop_in / side_panel_image and any image template.
 */
/** MIME for a known background image extension. */
function bgMimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  return "application/octet-stream";
}

/**
 * Resolve the per-MG background image params for eligible templates:
 *  • Translates `background_image_id` → `background_image_url` (a base64 data
 *    URL of the file bytes). We use a data URL — not file:// — because
 *    Hyperframes' headless Chrome (CDP-driven) times out on Page.captureScreenshot
 *    when a large file:// resource lives outside the composition's temp dir,
 *    which then cascades into "Memory allocation error" inside the libvpx-vp9
 *    alpha encoder. Inlining the bytes avoids any second file fetch.
 *  • Clamps `background_image_opacity` to 0-100 and defaults it to 30.
 *  • Validates `background_image_fit` against the allow-list (default "cover").
 *  • Strips all three keys for ineligible templates (defensive — a stale
 *    project should never sneak a backdrop onto meme_pop_in or side_panel_image).
 *  • A missing/orphaned file logs a warning and drops the params, so the
 *    composition renders without a background instead of crashing.
 */
async function resolveBackgroundParams(
  templateId: string,
  projectFolder: string | undefined,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Ineligible → strip everything (server-side guard).
  if (!isBackgroundEligible(templateId)) {
    if (
      "background_image_id" in params ||
      "background_image_opacity" in params ||
      "background_image_fit" in params ||
      "background_image_url" in params
    ) {
      const out = { ...params };
      delete out.background_image_id;
      delete out.background_image_opacity;
      delete out.background_image_fit;
      delete out.background_image_url;
      return out;
    }
    return params;
  }
  const id = typeof params.background_image_id === "string" ? params.background_image_id : "";
  if (!id) return params;

  // Without a project folder there's nothing to resolve against — strip and
  // continue. Same fate as a deleted file.
  if (!projectFolder) {
    bgWriteLog("WARN", "MG background image: no project folder, skipping background");
    const out = { ...params };
    delete out.background_image_id;
    delete out.background_image_opacity;
    delete out.background_image_fit;
    delete out.background_image_url;
    return out;
  }

  const abs = await resolveBackgroundAbsolutePath(projectFolder, id);
  if (!abs) {
    bgWriteLog("WARN", `MG background image not found on disk for id=${id}; rendering without bg`);
    const out = { ...params };
    delete out.background_image_id;
    delete out.background_image_opacity;
    delete out.background_image_fit;
    delete out.background_image_url;
    return out;
  }

  const opacity = clampBackgroundOpacity(
    typeof params.background_image_opacity === "number"
      ? params.background_image_opacity
      : DEFAULT_BG_OPACITY,
  );
  const fitRaw = typeof params.background_image_fit === "string" ? params.background_image_fit : "";
  const fit = (ALLOWED_BG_FITS as ReadonlySet<string>).has(fitRaw) ? fitRaw : DEFAULT_BG_FIT;

  // Inline as a data URL. Reads at most 10 MB (enforced at upload), so the
  // worst-case base64 string is ~13 MB — acceptable to embed once per render.
  let dataUrl: string;
  try {
    const bytes = await readFile(abs);
    const mime = bgMimeForExt(path.extname(abs));
    dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  } catch (err) {
    bgWriteLog(
      "WARN",
      `MG background image read failed for id=${id} (${(err as Error).message}); rendering without bg`,
    );
    const out = { ...params };
    delete out.background_image_id;
    delete out.background_image_opacity;
    delete out.background_image_fit;
    delete out.background_image_url;
    return out;
  }

  return {
    ...params,
    background_image_url: dataUrl,
    background_image_opacity: opacity,
    background_image_fit: fit,
  };
}

async function resolveAssetImageParams(
  ctx: LibraryContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (looksLikePathOrUrl(params.image)) return params; // already a real path/URL

  const ref =
    typeof params.asset_id === "string"
      ? params.asset_id
      : typeof params.image === "string"
        ? params.image
        : undefined;
  if (!ref) return params;

  try {
    const raw = await readFile(path.join(ctx.libraryRoot, "library_index.json"), "utf8");
    const index = JSON.parse(raw) as {
      assets?: LibraryIndexAsset[];
      asset_groups?: AssetGroupRecord[];
    };
    const assets = index.assets ?? [];

    const findPath = (id: string) => assets.find((a) => a.id === id)?.absolutePath;
    let absolutePath = findPath(ref);
    if (!absolutePath) {
      const group = (index.asset_groups ?? []).find(
        (g) => g.asset_id === ref || g.asset_group_id === ref,
      );
      if (group) {
        const variantId = group.variants.original || group.variants.nobg || group.variants.bg_blur;
        absolutePath = findPath(variantId);
      }
    }
    if (absolutePath) return { ...params, image: toFileUrl(absolutePath) };
  } catch {
    /* no library index / unreadable — leave params unchanged */
  }
  return params;
}

async function upsertLibraryIndex(
  ctx: LibraryContext,
  asset: LibraryIndexAsset,
): Promise<void> {
  const indexPath = path.join(ctx.libraryRoot, "library_index.json");
  let assets: LibraryIndexAsset[] = [];
  // Preserve asset_groups! It holds the player-image upload groups used by Asset
  // Onboarding to auto-resolve already-uploaded players. Dropping it here (this
  // runs on every motion-graphic build) is what made onboarding re-prompt.
  let assetGroups: unknown[] = [];
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as { assets?: LibraryIndexAsset[]; asset_groups?: unknown[] };
    if (Array.isArray(parsed.assets)) assets = parsed.assets;
    if (Array.isArray(parsed.asset_groups)) assetGroups = parsed.asset_groups;
  } catch {
    /* no index yet */
  }
  const existing = assets.findIndex((a) => a.id === asset.id);
  if (existing >= 0) assets[existing] = { ...assets[existing], ...asset };
  else assets.push(asset);
  await mkdir(ctx.libraryRoot, { recursive: true });
  await writeFile(indexPath, JSON.stringify({ assets, asset_groups: assetGroups }, null, 2), "utf8");
}

/**
 * Is the Hyperframes render browser (headless Chrome) actually downloaded?
 * `browser path` prints the EXPECTED location even when the executable hasn't
 * been downloaded yet, so we must confirm the file exists on disk — otherwise we
 * skip the download and renders fail with a missing-browser error.
 */
async function isHyperframesBrowserPresent(): Promise<boolean> {
  try {
    const r = await runCommand(hyperframesCommand(), ["browser", "path"]);
    if (r.code !== 0) return false;
    const candidate = r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .find((s) => existsSync(s));
    return Boolean(candidate);
  } catch {
    return false;
  }
}

export function registerMotionGraphicsHandlers(): void {
  // Ensure the headless-Chrome render engine is downloaded (run once on launch).
  // Streams progress lines so CADS can show a one-time "downloading" indicator.
  ipcMain.handle("motionGraphic:ensure-browser", async (event) => {
    try {
      if (await isHyperframesBrowserPresent()) {
        return { state: "ready" as const, alreadyPresent: true };
      }
      event.sender.send("motionGraphic:browser-progress", {
        line: "Downloading the motion-graphics engine (one-time, ~150 MB)…",
      });
      const code = await runCommandStreaming(hyperframesCommand(), ["browser", "ensure"], (line) =>
        event.sender.send("motionGraphic:browser-progress", { line }),
      );
      if (code === 0) return { state: "ready" as const, alreadyPresent: false };
      return {
        state: "error" as const,
        message:
          "Couldn’t download the motion-graphics engine. Check your internet connection, then restart C.A.D.S.",
      };
    } catch (err) {
      return { state: "error" as const, message: (err as Error).message };
    }
  });

  ipcMain.handle(
    "motionGraphic:build",
    async (
      _e,
      args: {
        assetId: string;
        templateId: string;
        params: Record<string, unknown>;
        projectFolder?: string;
      },
    ) => {
      const ctx = await libraryContext();
      let params = await resolveAssetImageParams(ctx, args.params);
      params = await resolveBackgroundParams(args.templateId, args.projectFolder, params);
      const result = await buildMotionGraphic(
        baseRequest(ctx, args.assetId, args.templateId, params),
        makeDeps(),
      );
      await upsertLibraryIndex(ctx, {
        id: result.assetId,
        filename: `${result.assetId}.webm`,
        relativePath: path.join("motion_graphics", `${result.assetId}.webm`),
        absolutePath: result.assetPath,
        category: "motion_graphic",
        thumbnailPath: result.thumbnailPath,
        hasAlpha: true,
        tags: [],
        addedAt: new Date().toISOString(),
        usageCount: 0,
        templateId: args.templateId,
        params: args.params,
        durationSeconds: result.durationSeconds,
      });
      return result;
    },
  );

  ipcMain.handle(
    "motionGraphic:rebuild",
    async (
      _e,
      args: {
        assetId: string;
        templateId: string;
        params: Record<string, unknown>;
        projectFolder?: string;
      },
    ) => {
      const ctx = await libraryContext();
      let params = await resolveAssetImageParams(ctx, args.params);
      params = await resolveBackgroundParams(args.templateId, args.projectFolder, params);
      const result = await rebuildMotionGraphic(
        baseRequest(ctx, args.assetId, args.templateId, params),
        makeDeps(),
      );
      await upsertLibraryIndex(ctx, {
        id: result.assetId,
        filename: `${result.assetId}.webm`,
        relativePath: path.join("motion_graphics", `${result.assetId}.webm`),
        absolutePath: result.assetPath,
        category: "motion_graphic",
        thumbnailPath: result.thumbnailPath,
        hasAlpha: true,
        tags: [],
        addedAt: new Date().toISOString(),
        usageCount: 0,
        templateId: args.templateId,
        params: args.params,
        durationSeconds: result.durationSeconds,
      });
      return result;
    },
  );

  ipcMain.handle(
    "motionGraphic:preview",
    async (
      _e,
      args: { templateId: string; params: Record<string, unknown>; projectFolder?: string },
    ) => {
      const ctx = await libraryContext();
      let params = await resolveAssetImageParams(ctx, args.params);
      params = await resolveBackgroundParams(args.templateId, args.projectFolder, params);
      return previewMotionGraphic(
        baseRequest(ctx, `preview-${Date.now()}`, args.templateId, params),
        makeDeps(),
      );
    },
  );
}
