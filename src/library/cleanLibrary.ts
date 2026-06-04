/*
 * Pure orphan-detection for the Asset Library "Clean library" action.
 *
 * An indexed asset is "orphaned" when the file it points to no longer exists on
 * disk — e.g. the user deleted or moved the image/webm outside the app. The
 * index (library_index.json) still lists it, so the UI shows a broken entry.
 *
 * This splits the index's assets into the ones still backed by a real file and
 * the orphans to drop. An asset is kept if EITHER its stored absolutePath OR its
 * relativePath (resolved against the current library root) exists — so simply
 * moving the whole library folder does not wrongly flag everything as broken.
 *
 * Filesystem access is injected, so this is unit-testable with no Node/fs.
 */

export interface IndexedAssetPaths {
  absolutePath?: string;
  relativePath?: string;
}

export function partitionLiveAssets<T extends IndexedAssetPaths>(
  assets: T[],
  fileExists: (absolutePath: string) => boolean,
  resolveFromRoot: (relativePath: string) => string,
): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const removed: T[] = [];
  for (const a of assets) {
    const absOk =
      typeof a.absolutePath === "string" && a.absolutePath.length > 0 && fileExists(a.absolutePath);
    const relOk =
      !absOk &&
      typeof a.relativePath === "string" &&
      a.relativePath.length > 0 &&
      fileExists(resolveFromRoot(a.relativePath));
    (absOk || relOk ? kept : removed).push(a);
  }
  return { kept, removed };
}
