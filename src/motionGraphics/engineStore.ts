/*
 * Tracks the one-time download of the motion-graphics render engine (Hyperframes'
 * headless Chrome). Kicked off automatically on first launch — never lazily when
 * the user previews a graphic — so the engine is ready by the time it's needed.
 * The banner only shows while downloading or on error; an already-present engine
 * resolves instantly and shows nothing.
 */

import { create } from "zustand";

export type EngineState = "idle" | "checking" | "downloading" | "ready" | "error";

interface EngineStatusState {
  state: EngineState;
  detail: string;
  set: (state: EngineState, detail?: string) => void;
}

export const useEngineStore = create<EngineStatusState>((set) => ({
  state: "idle",
  detail: "",
  set: (state, detail = "") => set({ state, detail }),
}));

let started = false;

/**
 * Ensure the render engine is downloaded. Idempotent — safe to call on every
 * mount; only the first call does work. Returns immediately if the engine is
 * already present (no banner shown).
 */
export async function ensureMotionGraphicsEngine(): Promise<void> {
  if (started || !window.cads?.motionGraphicsEngine) return;
  started = true;

  const set = (state: EngineState, detail?: string) => useEngineStore.getState().set(state, detail);
  set("checking");
  const unsubscribe = window.cads.motionGraphicsEngine.onProgress(({ line }) =>
    set("downloading", line),
  );
  try {
    const res = await window.cads.motionGraphicsEngine.ensureBrowser();
    set(res.state === "ready" ? "ready" : "error", res.state === "error" ? res.message : "");
  } catch (err) {
    set("error", (err as Error).message);
  } finally {
    unsubscribe();
  }
}
