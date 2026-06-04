/*
 * Asset Onboarding store (Zustand).
 *
 * Tracks the images the customGPT requires, one row per asset, plus whether the
 * local background-removal model is ready. Independent of projectStore and
 * assetStore. `allRequiredDone` is the single gate: optional assets never block.
 */

import { create } from "zustand";
import type { RequiredAsset } from "../project/editListParser";

export type AssetRowStatus = "pending" | "uploading" | "processing" | "done" | "error";

export interface AssetRowVariants {
  original: string;
  nobg: string;
  bgBlur: string;
}

export interface AssetRowState {
  assetId: string;
  status: AssetRowStatus;
  progress?: { stage: string; percent: number };
  variants?: AssetRowVariants;
  error?: string;
}

/** What the library_index says about a required asset (set by hydrate). */
export interface AssetLibraryMatch {
  /** e.g. "mathys-tel-action" — the actual NAS group folder/filename slug. */
  suggestedFilename: string;
}

interface OnboardingState {
  requiredAssets: RequiredAsset[];
  rows: Record<string, AssetRowState>;
  /**
   * Per-asset library info from the last NAS scan (assetId → matched group).
   * Used by the onboarding chip to show the slug that's actually on disk rather
   * than the JSON's image_subject, which can drift from the corrected NAS name.
   */
  libraryMatches: Record<string, AssetLibraryMatch>;
  modelReady: boolean;
  /** Derived: every non-optional asset's row is "done". */
  allRequiredDone: boolean;

  setRequiredAssets: (assets: RequiredAsset[]) => void;
  setRowStatus: (assetId: string, status: AssetRowStatus) => void;
  setRowProgress: (assetId: string, stage: string, percent: number) => void;
  setRowVariants: (assetId: string, variants: AssetRowVariants) => void;
  setRowError: (assetId: string, error: string) => void;
  setRowLibraryMatch: (assetId: string, match: AssetLibraryMatch) => void;
  setModelReady: (ready: boolean) => void;
  skipOptional: () => void;
  reset: () => void;
}

function computeAllRequiredDone(
  requiredAssets: RequiredAsset[],
  rows: Record<string, AssetRowState>,
): boolean {
  return requiredAssets
    .filter((a) => !a.optional)
    .every((a) => rows[a.asset_id]?.status === "done");
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  requiredAssets: [],
  rows: {},
  libraryMatches: {},
  modelReady: false,
  allRequiredDone: true, // no requirements yet → nothing blocking

  setRequiredAssets: (assets) =>
    set(() => {
      const rows: Record<string, AssetRowState> = {};
      for (const asset of assets) {
        rows[asset.asset_id] = { assetId: asset.asset_id, status: "pending" };
      }
      return {
        requiredAssets: assets,
        rows,
        libraryMatches: {}, // cleared — hydrate repopulates from the fresh scan
        allRequiredDone: computeAllRequiredDone(assets, rows),
      };
    }),

  setRowStatus: (assetId, status) =>
    set((state) => {
      const row = state.rows[assetId];
      if (!row) return state;
      const rows = { ...state.rows, [assetId]: { ...row, status, error: undefined } };
      return { rows, allRequiredDone: computeAllRequiredDone(state.requiredAssets, rows) };
    }),

  setRowProgress: (assetId, stage, percent) =>
    set((state) => {
      const row = state.rows[assetId];
      if (!row) return state;
      return {
        rows: { ...state.rows, [assetId]: { ...row, status: "processing", progress: { stage, percent } } },
      };
    }),

  setRowVariants: (assetId, variants) =>
    set((state) => {
      const row = state.rows[assetId];
      if (!row) return state;
      const rows = {
        ...state.rows,
        [assetId]: { ...row, status: "done" as const, variants, progress: undefined, error: undefined },
      };
      return { rows, allRequiredDone: computeAllRequiredDone(state.requiredAssets, rows) };
    }),

  setRowError: (assetId, error) =>
    set((state) => {
      const row = state.rows[assetId];
      if (!row) return state;
      const rows = { ...state.rows, [assetId]: { ...row, status: "error" as const, error } };
      return { rows, allRequiredDone: computeAllRequiredDone(state.requiredAssets, rows) };
    }),

  setRowLibraryMatch: (assetId, match) =>
    set((state) => ({ libraryMatches: { ...state.libraryMatches, [assetId]: match } })),

  setModelReady: (ready) => set({ modelReady: ready }),

  skipOptional: () =>
    set((state) => {
      const rows = { ...state.rows };
      for (const asset of state.requiredAssets) {
        if (asset.optional && rows[asset.asset_id]?.status !== "done") {
          rows[asset.asset_id] = { ...rows[asset.asset_id], status: "done" };
        }
      }
      return { rows, allRequiredDone: computeAllRequiredDone(state.requiredAssets, rows) };
    }),

  reset: () => set({ requiredAssets: [], rows: {}, libraryMatches: {}, allRequiredDone: true }),
}));
