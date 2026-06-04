/*
 * Electron IPC — Asset Library scan.
 *
 * Trusts the FILESYSTEM, not the stored index. The library_index.json on disk
 * can drift from reality (files renamed outside the app, an interrupted write
 * leaving a stale absolutePath). We enumerate <libraryRoot>/images/ directly,
 * group the variants by base name, and emit fresh asset_groups whose
 * suggested_filename matches the actual filenames the user can see on the NAS.
 * Stored display_name / image_subject are preserved when the group id matches.
 */

import { ipcMain } from "electron";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveLibraryRoot } from "./libraryPaths";
import { partitionLiveAssets } from "../../src/library/cleanLibrary";

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|avif|heic)$/i;
const NOBG_SUFFIX_RE = /-nobg\.[^.]+$/i;
const BLUR_SUFFIX_RE = /-bg-blur\.[^.]+$/i;

interface StoredAsset {
  id: string;
  absolutePath: string;
  relativePath?: string;
  [k: string]: unknown;
}
interface StoredGroup {
  asset_group_id: string;
  asset_id?: string;
  suggested_filename?: string;
  image_subject?: string;
  display_name?: string;
  variants?: { original: string; nobg: string; bg_blur: string };
  [k: string]: unknown;
}

/**
 * Classify an image file into (base, variant). Strip the variant suffix /
 * extension to recover the player slug (the group id stem).
 */
function classify(filename: string): { base: string; variant: "original" | "nobg" | "bg_blur" } | null {
  if (!IMAGE_EXT_RE.test(filename)) return null;
  if (BLUR_SUFFIX_RE.test(filename)) {
    return { base: filename.replace(BLUR_SUFFIX_RE, ""), variant: "bg_blur" };
  }
  if (NOBG_SUFFIX_RE.test(filename)) {
    return { base: filename.replace(NOBG_SUFFIX_RE, ""), variant: "nobg" };
  }
  return { base: filename.replace(IMAGE_EXT_RE, ""), variant: "original" };
}

async function scanImagesDir(root: string): Promise<Map<string, { original?: string; nobg?: string; bg_blur?: string }>> {
  const dir = path.join(root, "images");
  const byBase = new Map<string, { original?: string; nobg?: string; bg_blur?: string }>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return byBase; // no images dir yet
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      const s = await stat(full);
      if (!s.isFile()) continue;
    } catch {
      continue;
    }
    const c = classify(name);
    if (!c) continue;
    const slot = byBase.get(c.base) ?? {};
    slot[c.variant] = full;
    byBase.set(c.base, slot);
  }
  return byBase;
}

export function registerAssetHandlers(): void {
  ipcMain.handle("assets:scan", async () => {
    const root = await resolveLibraryRoot();
    const indexPath = path.join(root, "library_index.json");

    // Stored index — used only to PRESERVE display_name / image_subject on
    // matching groups, and to carry through non-image records (motion graphics).
    let storedAssets: StoredAsset[] = [];
    let storedGroups: StoredGroup[] = [];
    try {
      const parsed = JSON.parse(await readFile(indexPath, "utf8")) as {
        assets?: StoredAsset[];
        asset_groups?: StoredGroup[];
      };
      if (Array.isArray(parsed.assets)) storedAssets = parsed.assets;
      if (Array.isArray(parsed.asset_groups)) storedGroups = parsed.asset_groups;
    } catch {
      /* missing or unreadable — start fresh */
    }

    // Filesystem truth: walk the images dir.
    const baseGroups = await scanImagesDir(root);

    const fsAssetById = new Map<string, string>(); // id → absolutePath
    const fsGroups: StoredGroup[] = [];
    for (const [base, v] of baseGroups) {
      if (!v.original || !v.nobg || !v.bg_blur) continue; // incomplete → skip
      const gid = `group_${base}`;
      const ids = {
        original: `${gid}_original`,
        nobg: `${gid}_nobg`,
        bg_blur: `${gid}_bgblur`,
      };
      fsAssetById.set(ids.original, v.original);
      fsAssetById.set(ids.nobg, v.nobg);
      fsAssetById.set(ids.bg_blur, v.bg_blur);
      const stored = storedGroups.find((g) => g.asset_group_id === gid);
      fsGroups.push({
        asset_group_id: gid,
        asset_id: gid,
        suggested_filename: base,
        image_subject: stored?.image_subject,
        display_name: stored?.display_name,
        variants: ids,
      });
    }

    // Merge: stored records (with absolutePath OVERWRITTEN by filesystem truth
    // when the id matches an image we just walked), plus any new fs records that
    // weren't in the stored index, plus non-image stored records (e.g. motion
    // graphics) preserved as-is.
    const seen = new Set<string>();
    const merged: StoredAsset[] = [];
    for (const a of storedAssets) {
      if (typeof a?.id !== "string") continue;
      seen.add(a.id);
      const fsPath = fsAssetById.get(a.id);
      merged.push(fsPath ? { ...a, absolutePath: fsPath } : a);
    }
    for (const [id, fsPath] of fsAssetById) {
      if (!seen.has(id)) merged.push({ id, absolutePath: fsPath });
    }

    // asset_groups: filesystem-truth groups first. Any stored group with no
    // filesystem match (e.g. a renamed-away player whose files are gone) is
    // dropped — its asset records are also gone from disk, so hydrating them
    // would just hand the editor broken paths.
    const finalGroups: StoredGroup[] = fsGroups;

    return { assets: merged, asset_groups: finalGroups };
  });

  // "Clean library": drop index entries whose backing file no longer exists on
  // disk (deleted/moved outside the app), which otherwise show as broken assets.
  // Only removes records — never touches actual files (there is nothing to
  // delete; the file is already gone). asset_groups are preserved as-is; the
  // scan above rebuilds them from the filesystem anyway.
  ipcMain.handle("assets:clean", async () => {
    const root = await resolveLibraryRoot();
    const indexPath = path.join(root, "library_index.json");

    let assets: StoredAsset[] = [];
    let assetGroups: unknown[] = [];
    try {
      const parsed = JSON.parse(await readFile(indexPath, "utf8")) as {
        assets?: StoredAsset[];
        asset_groups?: unknown[];
      };
      if (Array.isArray(parsed.assets)) assets = parsed.assets;
      if (Array.isArray(parsed.asset_groups)) assetGroups = parsed.asset_groups;
    } catch {
      return { removed: 0, removedIds: [] as string[], kept: 0 }; // no/unreadable index — nothing to clean
    }

    const { kept, removed } = partitionLiveAssets(
      assets,
      (abs) => existsSync(abs),
      (rel) => path.join(root, rel),
    );

    if (removed.length > 0) {
      await writeFile(
        indexPath,
        JSON.stringify({ assets: kept, asset_groups: assetGroups }, null, 2),
        "utf8",
      );
    }

    return {
      removed: removed.length,
      removedIds: removed.map((a) => a.id).filter((id): id is string => typeof id === "string"),
      kept: kept.length,
    };
  });
}
