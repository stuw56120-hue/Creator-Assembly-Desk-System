/*
 * Save keyboard shortcut — pure helpers + dispatch.
 *
 * The actual keydown listener lives in useKeyboard (one global listener for
 * the whole editor); these helpers are split out so the match logic and
 * dispatch behaviour are unit-testable without a React renderer.
 *
 * Wiring:
 *   useKeyboard  ──── matchesSaveShortcut(e) ───►  dispatchSaveRequest()
 *                                                          │
 *                                                          ▼
 *                                            window.dispatchEvent("cads:save-request")
 *                                                          │
 *                                                          ▼
 *                                      Toolbar's useEffect listener → onSave()
 *
 * Why a window event and not a Zustand action: keeps the save logic and its
 * local saving/toast state inside the Toolbar component (no refactor), while
 * still letting any other future trigger (menu item, auto-save) fire the same
 * action by dispatching the event.
 */

/** The window event name used to ask the Toolbar to run its save handler. */
export const SAVE_REQUEST_EVENT = "cads:save-request";

interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Ctrl+S on Windows/Linux, Cmd+S on macOS. We deliberately do NOT key off
 * Shift (a future Save-As could be Cmd+Shift+S; this matcher will still
 * accept it because plain "Save" should fire as the broader intent).
 * Alt-modified is excluded so Cmd+Alt+S can carry a separate meaning later.
 *
 * Returns true on the keys we want to handle so the caller can preventDefault
 * — Chromium's default Ctrl+S would otherwise prompt to save the page as HTML.
 */
export function matchesSaveShortcut(e: KeyboardEventLike): boolean {
  if (e.altKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.key.toLowerCase() === "s";
}

/** Fire a window-level save request. The Toolbar listens. No-ops outside a DOM. */
export function dispatchSaveRequest(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SAVE_REQUEST_EVENT));
}
