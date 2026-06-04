/*
 * Global editor keyboard shortcuts:
 *   Space            play / pause
 *   Home             jump to the start (00:00:00)
 *   ← / →            step one frame (30fps) and seek
 *   Delete/Backspace delete the selected clip (refused for cuts/locked by store)
 *   Ctrl/Cmd+Z       undo      ·   Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y   redo
 *   Ctrl/Cmd+S       save (fires even when a text input has focus — standard
 *                    editor convention; preventDefault stops Chromium's
 *                    save-page-as-HTML)
 *
 * Text fields are respected for the navigational shortcuts (Space, arrows,
 * Delete, undo/redo) — shortcuts don't fire while typing. Save is the
 * exception: it always fires.
 */

import { useEffect } from "react";
import { playbackController } from "../player/usePlayback";
import { useProjectStore } from "../project/projectStore";
import { shouldHandleTimelineDeleteKey } from "../timeline/layout";
import { stepFrameTime } from "../player/time";
import { dispatchSaveRequest, matchesSaveShortcut } from "./saveShortcut";

/**
 * Should the editor's keyboard shortcuts (Space, Delete, arrows, …) skip this
 * event? True for any text/input/select/contenteditable element, AND for
 * anything nested inside an opted-out region (e.g. the Caption Editor modal —
 * marked `data-cads-no-shortcuts`) so Space inside it never accidentally
 * play/pauses the timeline behind the modal.
 */
function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (typeof el.closest === "function" && el.closest("[data-cads-no-shortcuts]")) return true;
  return false;
}

export function useKeyboard() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Save: fires regardless of focus (including text inputs — standard
      // editor convention). preventDefault stops Chromium's save-page-as-HTML
      // dialog. The window event is delivered to the Toolbar's listener,
      // which no-ops when a save is already in-flight.
      if (matchesSaveShortcut(e)) {
        e.preventDefault();
        dispatchSaveRequest();
        return;
      }

      // Undo / redo work even when focused in the timeline; not inside text fields.
      if (mod && e.key.toLowerCase() === "z" && !isTextField(e.target)) {
        e.preventDefault();
        if (e.shiftKey) useProjectStore.getState().redo();
        else useProjectStore.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !isTextField(e.target)) {
        e.preventDefault();
        useProjectStore.getState().redo();
        return;
      }

      if (isTextField(e.target)) return;

      if (e.key === " ") {
        e.preventDefault();
        playbackController.toggle();
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        playbackController.seek(0);
        return;
      }

      if (
        shouldHandleTimelineDeleteKey({
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          target: e.target,
        })
      ) {
        const id = useProjectStore.getState().selectedEventId;
        if (id) {
          useProjectStore.getState().removeEvent(id);
          useProjectStore.getState().setSelectedEvent(null);
        }
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const delta = e.key === "ArrowRight" ? 1 : -1;
        playbackController.seek(stepFrameTime(playbackController.getTime(), delta));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
