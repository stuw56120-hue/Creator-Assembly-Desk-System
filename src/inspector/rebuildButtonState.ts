/*
 * Pure state mapping for the Motion-Graphic Inspector's Rebuild button.
 * Kept separate so the button's labels/disabled/spinner visibility can be
 * pinned by unit tests without needing a DOM environment.
 *
 * The Inspector's overall phase has five values (see MotionGraphicInspector):
 *   idle, previewing, rebuilding, done, error
 *
 * The Rebuild button itself cares about FOUR of those:
 *   - rebuilding: show "Rebuilding…" with the spinner, disable to prevent
 *                 double-clicks firing parallel rebuilds.
 *   - previewing: rebuild is conceptually queued behind the preview render,
 *                 so we disable it to prevent racing — but show no spinner
 *                 (the Preview button owns the busy indicator in that state).
 *   - error:      the last rebuild FAILED. Show a distinct, visible error label
 *                 (and `error: true` so the button can be styled), but keep it
 *                 ENABLED so the user can retry. Never silently fall back to the
 *                 plain "Rebuild" resting look — that reads as "nothing happened".
 *   - idle / done: the plain resting state — "Rebuild", enabled, no spinner.
 */

export type RebuildPhase = "idle" | "previewing" | "rebuilding" | "done" | "error";

export interface RebuildButtonState {
  label: string;
  disabled: boolean;
  showSpinner: boolean;
  /** The last rebuild failed — style the button as an error and let it retry. */
  error?: boolean;
}

export const REBUILD_LABEL_IDLE = "Rebuild";
export const REBUILD_LABEL_BUSY = "Rebuilding…";
export const REBUILD_LABEL_ERROR = "Rebuild failed — try again";

export function rebuildButtonState(phase: RebuildPhase): RebuildButtonState {
  if (phase === "rebuilding") {
    return { label: REBUILD_LABEL_BUSY, disabled: true, showSpinner: true };
  }
  if (phase === "previewing") {
    return { label: REBUILD_LABEL_IDLE, disabled: true, showSpinner: false };
  }
  if (phase === "error") {
    // Visible failure state — enabled so the click becomes a retry.
    return { label: REBUILD_LABEL_ERROR, disabled: false, showSpinner: false, error: true };
  }
  // idle / done → plain resting state.
  return { label: REBUILD_LABEL_IDLE, disabled: false, showSpinner: false };
}
