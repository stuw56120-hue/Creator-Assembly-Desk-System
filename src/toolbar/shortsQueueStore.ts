/*
 * Controls the Shorts approval/render modal (ShortsQueue). The Shorts inspector's
 * "Render Preview" button opens it on a specific short and auto-starts the
 * proxy-first render; closing resets the state.
 */

import { create } from "zustand";

interface ShortsQueueState {
  open: boolean;
  /** short_in event id to start the queue on, or null to start at the first. */
  initialShortId: string | null;
  /** Auto-trigger the 720p preview render on open (from the inspector button). */
  autoPreview: boolean;
  openQueue: (shortId?: string, autoPreview?: boolean) => void;
  closeQueue: () => void;
}

export const useShortsQueueStore = create<ShortsQueueState>((set) => ({
  open: false,
  initialShortId: null,
  autoPreview: false,
  openQueue: (shortId, autoPreview = false) =>
    set({ open: true, initialShortId: shortId ?? null, autoPreview }),
  closeQueue: () => set({ open: false, initialShortId: null, autoPreview: false }),
}));
