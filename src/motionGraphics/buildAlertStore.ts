/*
 * Holds a plain-English alert shown to the user when a background motion-graphic
 * build can't run because a required tool is missing (e.g. Hyperframes not
 * installed). The editor renders it as a dismissible banner. Only "tool missing"
 * messages are surfaced here — ordinary per-graphic build failures stay in the log.
 */

import { create } from "zustand";

interface BuildAlertState {
  /** The message to show, or null when there's nothing to surface. */
  message: string | null;
  setMessage: (message: string | null) => void;
}

export const useBuildAlertStore = create<BuildAlertState>((set) => ({
  message: null,
  setMessage: (message) => set({ message }),
}));

/** Heuristic: does a build error read like a missing-tool message worth surfacing to the user? */
export function isToolMissingError(message: string): boolean {
  return /isn’t installed|not installed|on your PATH|built-in motion-graphics renderer|reinstalling C\.A\.D\.S\./i.test(
    message,
  );
}
