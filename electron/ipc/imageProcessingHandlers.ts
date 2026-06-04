/*
 * Electron IPC — image onboarding pipeline.
 *
 * Spawns workers/process_image_worker.py (never runs in-process), streams its
 * stderr progress to the renderer, and registers the three produced variants
 * (original / nobg / bg-blur) in library_index.json under a shared asset group.
 *
 *   image:check-model  → { downloaded, sizeMb }   (checks ~/.u2net/u2net.onnx)
 *   image:upload       → { original, nobg, bgBlur, assetGroupId }
 */

import { ipcMain, app, type IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveLibraryRoot, ensureLibraryWritable } from "./libraryPaths";

const PYTHON_BIN = process.env.CADS_PYTHON_BIN ?? "python";
const ACCEPTED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

interface WorkerResult {
  original: string;
  nobg: string;
  bg_blur: string;
  width: number;
  height: number;
  has_alpha: boolean;
}

interface ProgressMessage {
  assetId: string;
  stage: string;
  percent: number;
  modelDownload?: boolean;
}

function u2netModelPath(): string {
  return path.join(os.homedir(), ".u2net", "u2net.onnx");
}

/** Spawn the image worker with the given args; resolve raw stdout, stream progress. */
function spawnWorker(
  workerArgs: string[],
  onProgress: (msg: { stage: string; percent: number; modelDownload?: boolean }) => void,
): Promise<string> {
  const script = path.join(app.getAppPath(), "workers", "process_image_worker.py");
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [script, ...workerArgs], {
      windowsHide: true,
      // Avoid Windows HF-hub symlink failures (WinError 1314) on any HF-backed download.
      env: { ...process.env, HF_HUB_DISABLE_SYMLINKS: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" },
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        const m = /^PROGRESS (.+) (\d+)$/.exec(line.trim());
        if (m) {
          onProgress({ stage: m[1], percent: Number(m[2]) });
        } else if (line.includes("u2net.onnx")) {
          onProgress({
            stage: "Downloading AI model for background removal (one-time, ~170MB)…",
            percent: 0,
            modelDownload: true,
          });
        }
      }
    });

    child.on("error", (err) =>
      reject(new Error(`Failed to start Python worker ("${PYTHON_BIN}"): ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Worker exited with code ${code}`));
    });
  });
}

async function runWorker(
  input: string,
  outputDir: string,
  filename: string,
  onProgress: (msg: { stage: string; percent: number; modelDownload?: boolean }) => void,
): Promise<WorkerResult> {
  const stdout = await spawnWorker(
    ["--input", input, "--output-dir", outputDir, "--filename", filename],
    onProgress,
  );
  try {
    return JSON.parse(stdout) as WorkerResult;
  } catch {
    throw new Error(`Worker produced invalid JSON: ${stdout.slice(0, 200)}`);
  }
}

interface LibraryAssetRecord {
  id: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  category: "image";
  thumbnailPath: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  tags: string[];
  addedAt: string;
  usageCount: number;
}

interface AssetGroupRecord {
  asset_group_id: string;
  asset_id: string;
  suggested_filename: string;
  /** The player slug (e.g. "matis_tel") this group belongs to, if any. */
  image_subject?: string;
  /** The on-screen display name (e.g. "Mathis Tel"), edited in onboarding. */
  display_name?: string;
  variants: { original: string; nobg: string; bg_blur: string };
}

interface LibraryIndex {
  assets: LibraryAssetRecord[];
  asset_groups: AssetGroupRecord[];
}

async function readIndex(): Promise<LibraryIndex> {
  const indexPath = path.join(await resolveLibraryRoot(), "library_index.json");
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LibraryIndex>;
    return {
      assets: Array.isArray(parsed.assets) ? (parsed.assets as LibraryAssetRecord[]) : [],
      asset_groups: Array.isArray(parsed.asset_groups) ? parsed.asset_groups : [],
    };
  } catch {
    return { assets: [], asset_groups: [] };
  }
}

async function writeIndex(index: LibraryIndex): Promise<void> {
  const root = await resolveLibraryRoot();
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "library_index.json"), JSON.stringify(index, null, 2), "utf8");
}

function variantRecord(
  id: string,
  absolutePath: string,
  result: WorkerResult,
  hasAlpha: boolean,
  group: string,
): LibraryAssetRecord {
  return {
    id,
    filename: path.basename(absolutePath),
    relativePath: path.join("images", path.basename(absolutePath)),
    absolutePath,
    category: "image",
    thumbnailPath: absolutePath, // an image is its own thumbnail
    width: result.width,
    height: result.height,
    hasAlpha,
    tags: [group],
    addedAt: new Date().toISOString(),
    usageCount: 0,
  };
}

async function registerGroup(
  assetId: string,
  suggestedFilename: string,
  result: WorkerResult,
  imageSubject?: string,
): Promise<string> {
  const assetGroupId = `group_${suggestedFilename}`;
  const ids = {
    original: `${assetGroupId}_original`,
    nobg: `${assetGroupId}_nobg`,
    bg_blur: `${assetGroupId}_bgblur`,
  };

  const index = await readIndex();
  const records = [
    variantRecord(ids.original, result.original, result, result.has_alpha, assetGroupId),
    variantRecord(ids.nobg, result.nobg, result, true, assetGroupId),
    variantRecord(ids.bg_blur, result.bg_blur, result, false, assetGroupId),
  ];
  // Upsert each variant by id.
  for (const rec of records) {
    const existing = index.assets.findIndex((a) => a.id === rec.id);
    if (existing >= 0) index.assets[existing] = rec;
    else index.assets.push(rec);
  }

  const gi = index.asset_groups.findIndex((g) => g.asset_group_id === assetGroupId);
  const group: AssetGroupRecord = {
    asset_group_id: assetGroupId,
    asset_id: assetId,
    suggested_filename: suggestedFilename,
    // Persist the player slug so later sessions can resolve uploads by subject;
    // keep any display name the user already saved for this group.
    image_subject: imageSubject ?? (gi >= 0 ? index.asset_groups[gi].image_subject : undefined),
    display_name: gi >= 0 ? index.asset_groups[gi].display_name : undefined,
    variants: ids,
  };
  if (gi >= 0) index.asset_groups[gi] = group;
  else index.asset_groups.push(group);

  await writeIndex(index);
  return assetGroupId;
}

/** Player slug, matching playerAssets.ts (used in asset_group_id / suggested_filename). */
function subjectSlug(subject: string): string {
  return subject.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Write a player's display name onto every asset group for that player, and
 * persist it across sessions.
 *
 * Groups are matched by `image_subject` when present, but FALL BACK to the slug
 * embedded in the group id / suggested_filename (`group_<slug>-<role>`) — older
 * uploads were registered without an image_subject, so an exact-equality match
 * found nothing and the name was silently never saved. On a slug match we also
 * BACKFILL image_subject, so future loads (which look up by image_subject) work.
 * Returns the number of groups updated.
 */
async function setPlayerName(imageSubject: string, displayName: string): Promise<number> {
  const index = await readIndex();
  const slug = subjectSlug(imageSubject);
  const idPrefix = `group_${slug}-`;
  let changed = 0;
  for (const group of index.asset_groups) {
    const belongs =
      group.image_subject === imageSubject ||
      (slug !== "" &&
        (group.asset_group_id === `group_${slug}` ||
          group.asset_group_id.startsWith(idPrefix) ||
          group.suggested_filename === slug ||
          (group.suggested_filename ?? "").startsWith(`${slug}-`)));
    if (belongs) {
      group.display_name = displayName;
      if (!group.image_subject) group.image_subject = imageSubject; // backfill for next load
      changed++;
    }
  }
  if (changed > 0) await writeIndex(index);
  return changed;
}

export function registerImageProcessingHandlers(): void {
  ipcMain.handle("image:check-model", async () => {
    try {
      const s = await stat(u2netModelPath());
      return { downloaded: true, sizeMb: Math.round(s.size / 1_000_000) };
    } catch {
      return { downloaded: false, sizeMb: 0 };
    }
  });

  ipcMain.handle("image:download-model", async (event: IpcMainInvokeEvent) => {
    await spawnWorker(["--prefetch-model"], (msg) => {
      event.sender.send("image:upload-progress", { assetId: "__model__", ...msg });
    });
    return { downloaded: true };
  });

  ipcMain.handle(
    "image:upload",
    async (
      event: IpcMainInvokeEvent,
      args: { filePath: string; assetId: string; suggestedFilename: string; imageSubject?: string },
    ) => {
      const ext = path.extname(args.filePath).toLowerCase();
      if (!ACCEPTED_EXT.has(ext)) {
        // Safety net — the renderer validates first.
        throw new Error(`Unsupported file type "${ext}". Use JPG, PNG, WEBP, or HEIC.`);
      }

      const imagesDir = path.join(await ensureLibraryWritable(), "images");
      await mkdir(imagesDir, { recursive: true });

      const result = await runWorker(args.filePath, imagesDir, args.suggestedFilename, (msg) => {
        const payload: ProgressMessage = { assetId: args.assetId, ...msg };
        event.sender.send("image:upload-progress", payload);
      });

      const assetGroupId = await registerGroup(
        args.assetId,
        args.suggestedFilename,
        result,
        args.imageSubject,
      );
      return {
        original: result.original,
        nobg: result.nobg,
        bgBlur: result.bg_blur,
        assetGroupId,
      };
    },
  );

  ipcMain.handle(
    "assets:set-player-name",
    async (_event, args: { imageSubject: string; displayName: string }) => {
      const updated = await setPlayerName(args.imageSubject, args.displayName);
      // ok:false when no library group matched this player — the rename still
      // holds for this session (and saves into the project) but can't persist
      // library-wide until the player's images are in the library.
      return { ok: updated > 0, groupsUpdated: updated };
    },
  );
}
