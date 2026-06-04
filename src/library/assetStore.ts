/*
 * C.A.D.S. Asset Library store (Zustand).
 *
 * Holds the indexed assets (images, memes, motion graphics) shown in the left
 * sidebar, with a search query and category filter. Motion graphic assets also
 * carry their templateId + params so they can be re-opened in the Inspector.
 */

import { create } from "zustand";

export type AssetCategory = "image" | "meme" | "motion_graphic";

export interface LibraryAsset {
  id: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  category: AssetCategory;
  thumbnailPath?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  tags: string[];
  addedAt: string;
  usageCount: number;
  // motion_graphic only:
  templateId?: string;
  params?: Record<string, unknown>;
  durationSeconds?: number;
}

export type CategoryFilter = AssetCategory | "all";

/** A processed-image triad (original / nobg / bg-blur), linked in the index. */
export interface AssetGroup {
  assetGroupId: string;
  assetId: string;
  suggestedFilename: string;
  variants: { original: string; nobg: string; bgBlur: string };
}

interface AssetState {
  assets: LibraryAsset[];
  groups: AssetGroup[];
  query: string;
  category: CategoryFilter;

  setAssets: (assets: LibraryAsset[]) => void;
  setGroups: (groups: AssetGroup[]) => void;
  addAsset: (asset: LibraryAsset) => void;
  upsertAsset: (asset: LibraryAsset) => void;
  setQuery: (query: string) => void;
  setCategory: (category: CategoryFilter) => void;

  /** Assets matching the current category filter + filename/tag query. */
  visibleAssets: () => LibraryAsset[];
  /** Look up a single asset by id (for resolving group variants). */
  assetById: (id: string) => LibraryAsset | undefined;
}

/**
 * What the Asset Library "+" button does, based on the open sub-panel (Bug 7).
 * The button is contextual: it adds the kind of asset the active tab shows —
 * a motion graphic (opens the studio), or an image / meme (file import). The
 * "all" default falls back to the motion-graphic studio (its original action).
 */
export type AddActionKind = "motion_graphic" | "image" | "meme";

export function contextualAddAction(category: CategoryFilter): {
  kind: AddActionKind;
  label: string;
} {
  switch (category) {
    case "image":
      return { kind: "image", label: "Add an image" };
    case "meme":
      return { kind: "meme", label: "Add a meme" };
    case "motion_graphic":
    default:
      return { kind: "motion_graphic", label: "Create a motion graphic" };
  }
}

/**
 * Whether a library asset is a motion graphic that has a background image set
 * (Fix 3 — shows an indicator in the list row). The MG's build params carry the
 * background reference (background_image_id, or background_image_url once
 * resolved). Non-MG assets never have one.
 */
export function assetHasBackground(asset: Pick<LibraryAsset, "category" | "params">): boolean {
  if (asset.category !== "motion_graphic" || !asset.params) return false;
  const id = asset.params.background_image_id;
  const url = asset.params.background_image_url;
  return (typeof id === "string" && id.length > 0) || (typeof url === "string" && url.length > 0);
}

/** Pure filter — exported for testing without the store. */
export function filterAssets(
  assets: LibraryAsset[],
  category: CategoryFilter,
  query: string,
): LibraryAsset[] {
  const q = query.trim().toLowerCase();
  return assets.filter((a) => {
    if (category !== "all" && a.category !== category) return false;
    if (!q) return true;
    return (
      a.filename.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: [],
  groups: [],
  query: "",
  category: "all",

  setAssets: (assets) => set({ assets }),
  setGroups: (groups) => set({ groups }),
  addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),
  upsertAsset: (asset) =>
    set((s) => {
      const idx = s.assets.findIndex((a) => a.id === asset.id);
      if (idx < 0) return { assets: [...s.assets, asset] };
      const next = s.assets.slice();
      next[idx] = asset;
      return { assets: next };
    }),
  setQuery: (query) => set({ query }),
  setCategory: (category) => set({ category }),

  visibleAssets: () => {
    const { assets, category, query } = get();
    return filterAssets(assets, category, query);
  },
  assetById: (id) => get().assets.find((a) => a.id === id),
}));
