/*
 * Loads the Asset Library index (assets + processed-image groups) from the main
 * process into the asset store. Tolerates the legacy array-only scan shape.
 */

import { useEffect } from "react";
import { useAssetStore, type AssetGroup, type LibraryAsset } from "./assetStore";

interface RawGroup {
  asset_group_id: string;
  asset_id: string;
  suggested_filename: string;
  variants: { original: string; nobg: string; bg_blur: string };
}

function mapGroups(raw: unknown[]): AssetGroup[] {
  return (raw as RawGroup[]).map((g) => ({
    assetGroupId: g.asset_group_id,
    assetId: g.asset_id,
    suggestedFilename: g.suggested_filename,
    variants: {
      original: g.variants.original,
      nobg: g.variants.nobg,
      bgBlur: g.variants.bg_blur,
    },
  }));
}

/**
 * Scan the library index and push the result into the store. Exported so it can
 * be called outside React (e.g. after "Clean library" removes orphaned entries)
 * to refresh the sidebar. Reads the setters off the store directly.
 */
export async function refreshAssetLibrary(): Promise<void> {
  const { setAssets, setGroups } = useAssetStore.getState();
  try {
    const res = await window.cads?.assets?.scan();
    if (!res) {
      setAssets([]);
      setGroups([]);
      return;
    }
    // New shape: { assets, asset_groups }. Legacy: plain array.
    if (Array.isArray(res)) {
      setAssets(res as LibraryAsset[]);
      setGroups([]);
      return;
    }
    setAssets((res.assets ?? []) as LibraryAsset[]);
    setGroups(mapGroups(res.asset_groups ?? []));
  } catch {
    setAssets([]);
    setGroups([]);
  }
}

export function useAssetLibrary() {
  useEffect(() => {
    void refreshAssetLibrary();
  }, []);
}
