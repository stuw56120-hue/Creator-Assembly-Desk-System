/*
 * Electron IPC — Motion-Graphic background image storage.
 *
 *   mgBackground:upload(projectFolder, sourcePath)
 *     → { ok:true, id, originalFilename, ext, bytes, createdAt, absolutePath }
 *     | { ok:false, error }
 *
 *   mgBackground:list(projectFolder)
 *     → BackgroundIndexEntry[]
 *
 * Storage: <projectFolder>/assets/mg-backgrounds/{uuid}.{ext} (per spec).
 * The index lives next to the files so an external file copy stays
 * self-describing. The handler validates extension + 10 MB size cap on both
 * sides of the IPC boundary so a renderer bug can't smuggle a 4 GB PSD in.
 */

import { ipcMain } from "electron";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  appendBackgroundEntry,
  parseBackgroundIndex,
  uuidV4,
  validateBackgroundUpload,
  type BackgroundIndexEntry,
  type BackgroundIndexFile,
} from "../../src/motionGraphics/backgroundAssets";

function backgroundsDir(projectFolder: string): string {
  return path.join(projectFolder, "assets", "mg-backgrounds");
}

function indexPath(projectFolder: string): string {
  return path.join(backgroundsDir(projectFolder), "index.json");
}

/** Read the index file (or return an empty one). Never throws. */
async function readIndex(projectFolder: string): Promise<BackgroundIndexFile> {
  try {
    const raw = await readFile(indexPath(projectFolder), "utf8");
    return parseBackgroundIndex(raw);
  } catch {
    return { entries: [] };
  }
}

async function writeIndex(projectFolder: string, index: BackgroundIndexFile): Promise<void> {
  await mkdir(backgroundsDir(projectFolder), { recursive: true });
  await writeFile(indexPath(projectFolder), JSON.stringify(index, null, 2), "utf8");
}

export function registerMgBackgroundHandlers(): void {
  ipcMain.handle(
    "mgBackground:upload",
    async (
      _event,
      args: { projectFolder: string; sourcePath: string },
    ): Promise<
      | {
          ok: true;
          id: string;
          originalFilename: string;
          ext: string;
          bytes: number;
          createdAt: string;
          absolutePath: string;
        }
      | { ok: false; error: string }
    > => {
      if (!args?.projectFolder || !args?.sourcePath) {
        return { ok: false, error: "Project folder or source file is missing." };
      }
      // Stat the source first so we can apply the 10 MB cap before any I/O.
      let sz: number;
      try {
        const s = await stat(args.sourcePath);
        if (!s.isFile()) return { ok: false, error: "Selected path is not a file." };
        sz = s.size;
      } catch (err) {
        return { ok: false, error: `Couldn't read the selected file: ${(err as Error).message}` };
      }
      const originalFilename = path.basename(args.sourcePath);
      const validation = validateBackgroundUpload(originalFilename, sz);
      if (!validation.ok) return { ok: false, error: validation.error };

      const id = uuidV4();
      const ext = validation.ext;
      const dir = backgroundsDir(args.projectFolder);
      const dest = path.join(dir, `${id}${ext}`);
      try {
        await mkdir(dir, { recursive: true });
        await copyFile(args.sourcePath, dest);
      } catch (err) {
        return { ok: false, error: `Couldn't save the image: ${(err as Error).message}` };
      }

      const entry: BackgroundIndexEntry = {
        id,
        original_filename: originalFilename,
        ext,
        bytes: sz,
        created_at: new Date().toISOString(),
      };
      const current = await readIndex(args.projectFolder);
      await writeIndex(args.projectFolder, appendBackgroundEntry(current, entry));

      return {
        ok: true,
        id,
        originalFilename,
        ext,
        bytes: sz,
        createdAt: entry.created_at,
        absolutePath: dest,
      };
    },
  );

  ipcMain.handle(
    "mgBackground:list",
    async (_event, args: { projectFolder: string }): Promise<BackgroundIndexEntry[]> => {
      if (!args?.projectFolder) return [];
      const idx = await readIndex(args.projectFolder);
      return idx.entries;
    },
  );
}

/**
 * Resolve a background id to its absolute file path on disk. Returns null
 * when the id isn't in the index OR the file is missing. Used by the MG
 * build path (see motionGraphicsHandlers.resolveBackgroundParams).
 */
export async function resolveBackgroundAbsolutePath(
  projectFolder: string,
  id: string,
): Promise<string | null> {
  if (!projectFolder || !id) return null;
  const idx = await readIndex(projectFolder);
  const entry = idx.entries.find((e) => e.id === id);
  if (!entry) return null;
  const p = path.join(backgroundsDir(projectFolder), `${entry.id}${entry.ext}`);
  try {
    await stat(p);
    return p;
  } catch {
    return null;
  }
}
