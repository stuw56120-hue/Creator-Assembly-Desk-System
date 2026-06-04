/*
 * C.A.D.S. project store (Zustand).
 *
 * Holds the approved/working timeline and a full undo/redo history covering all
 * mutations — toggles, moves/resizes, label edits, library drops, MG build
 * status, and approval (per spec: "Undo/redo covers all mutations").
 *
 * Spec constraints enforced here:
 *  - Cuts are toggled off, never deleted.
 *  - Locked clips cannot be moved/resized/deleted — only toggled enabled.
 *  - Keep segments are recomputed from enabled cuts after any change.
 *  - Approve is blocked until zero reviewRequired events remain unresolved.
 */

import { create } from "zustand";
import { buildKeepSegments } from "./timelineBuilder";
import { applyDisplayNameToEvents } from "./displayNames";
import {
  captionToEvent,
  eventToCaptionSegment,
  mergeCaptionSegments,
  splitCaptionSegment,
  type CaptionCore,
} from "./captions";
import type { KeepSegment, MotionGraphicBuildStatus, TimelineEvent } from "./types";

let captionIdCounter = 0;
function nextCaptionId(): string {
  return `cap_${Date.now().toString(36)}_${captionIdCounter++}`;
}

/** Geometry/label edits permitted on an unlocked clip. */
export type EventEdit = Partial<
  Pick<TimelineEvent, "start" | "duration" | "track" | "label" | "confidence">
> & {
  overlayData?: Partial<NonNullable<TimelineEvent["overlayData"]>>;
  shortData?: Partial<NonNullable<TimelineEvent["shortData"]>>;
  chapterData?: Partial<NonNullable<TimelineEvent["chapterData"]>>;
  captionData?: Partial<NonNullable<TimelineEvent["captionData"]>>;
};

interface HistorySnapshot {
  events: TimelineEvent[];
  keepSegments: KeepSegment[];
  approved: boolean;
}

interface ProjectState {
  projectName: string;
  durationSeconds: number;
  /** Absolute path to the source video (used by the render pipeline). */
  sourceVideoPath: string;
  events: TimelineEvent[];
  keepSegments: KeepSegment[];
  approved: boolean;
  /** image_subject → human display name (Mathis Tel). Shown/rendered everywhere. */
  playerDisplayNames: Record<string, string>;
  /** Caption appearance preset (clean_podcast | bold_social | quote_emphasis). */
  captionStyle: string;
  /** UI selection — not part of undo history. */
  selectedEventId: string | null;
  past: HistorySnapshot[];
  future: HistorySnapshot[];

  /** Load a freshly built timeline (or a reopened snapshot). Clears history. */
  loadTimeline: (input: {
    projectName: string;
    durationSeconds: number;
    sourceVideoPath?: string;
    events: TimelineEvent[];
    keepSegments: KeepSegment[];
    approved?: boolean;
    playerDisplayNames?: Record<string, string>;
  }) => void;

  /** Set the caption appearance preset (not undoable). */
  setCaptionStyle: (style: string) => void;

  /** Seed the player display-name map (no event rewrite, not undoable). */
  setPlayerDisplayNames: (names: Record<string, string>) => void;
  /** Rename a player: update the map + rewrite the reference everywhere (undoable). */
  setPlayerDisplayName: (imageSubject: string, displayName: string) => void;

  /** Confirm or change the source video path (Step 1 of the opening flow). */
  setSourceVideoPath: (path: string) => void;
  setSelectedEvent: (id: string | null) => void;
  toggleEvent: (id: string) => void;
  updateEvent: (id: string, edit: EventEdit) => void;
  resolveReview: (id: string) => void;
  addEvent: (event: TimelineEvent) => void;
  removeEvent: (id: string) => void;
  setMotionGraphicBuildStatus: (
    id: string,
    status: MotionGraphicBuildStatus,
    assetPath?: string,
  ) => void;
  /**
   * Fill in the on-disk image path for every image overlay whose
   * overlayData.assetId matches a key in the map (assetId → absolute path).
   * Used after Asset Onboarding to link uploaded/library player images to their
   * timeline overlays so the picture shows in the preview. System-derived, so it
   * does NOT record undo history.
   */
  setImageOverlayAssetPaths: (pathByAssetId: Record<string, string>) => void;
  updateMotionGraphicParams: (id: string, params: Record<string, unknown>) => void;

  /** Replace the entire caption track (e.g. from an uploaded transcript). */
  setCaptions: (segments: (CaptionCore & { id?: string })[]) => void;
  /** Split a caption into two at a character index in its text. */
  splitCaption: (id: string, charIndex: number) => void;
  /** Merge two adjacent captions into one. */
  mergeCaptions: (idA: string, idB: string) => void;

  approve: () => void;
  unapprove: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /** Events still flagging ⚠ — must be empty before approval. */
  unresolvedReviewCount: () => number;
  canApprove: () => boolean;
}

function cloneEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.map((e) => structuredClone(e));
}

const isCut = (e: TimelineEvent) => e.kind === "cut";
const hasCut = (events: TimelineEvent[]) => events.some(isCut);

export const useProjectStore = create<ProjectState>((set, get) => {
  /** Snapshot current undoable state. */
  function snapshot(state: ProjectState): HistorySnapshot {
    return {
      events: cloneEvents(state.events),
      keepSegments: state.keepSegments.map((s) => ({ ...s })),
      approved: state.approved,
    };
  }

  /**
   * Apply a pure transform to the event list, recompute keep segments,
   * push the prior state onto the undo stack, and clear the redo stack.
   * If the transform returns the same array reference, nothing is recorded.
   */
  function mutate(transform: (events: TimelineEvent[]) => TimelineEvent[] | null) {
    set((state) => {
      const nextEvents = transform(state.events);
      if (nextEvents === null) return state; // no-op (e.g. locked clip)

      const keepSegments = hasCut(nextEvents)
        ? buildKeepSegments(state.durationSeconds, nextEvents)
        : state.keepSegments;

      return {
        ...state,
        events: nextEvents,
        keepSegments,
        past: [...state.past, snapshot(state)],
        future: [],
      };
    });
  }

  return {
    projectName: "",
    durationSeconds: 0,
    sourceVideoPath: "",
    events: [],
    keepSegments: [],
    approved: false,
    playerDisplayNames: {},
    captionStyle: "clean_podcast",
    selectedEventId: null,
    past: [],
    future: [],

    setCaptionStyle: (style) => set({ captionStyle: style }),

    loadTimeline: ({
      projectName,
      durationSeconds,
      sourceVideoPath,
      events,
      keepSegments,
      approved,
      playerDisplayNames,
    }) =>
      set({
        projectName,
        durationSeconds,
        sourceVideoPath: sourceVideoPath ?? "",
        events: cloneEvents(events),
        keepSegments: keepSegments.map((s) => ({ ...s })),
        approved: approved ?? false,
        playerDisplayNames: playerDisplayNames ?? {},
        selectedEventId: null,
        past: [],
        future: [],
      }),

    setSourceVideoPath: (path) => set({ sourceVideoPath: path }),

    setSelectedEvent: (id) => set({ selectedEventId: id }),

    setPlayerDisplayNames: (names) => set({ playerDisplayNames: { ...names } }),

    setPlayerDisplayName: (imageSubject, displayName) => {
      const prev = get().playerDisplayNames[imageSubject] ?? imageSubject;
      set((state) => ({
        playerDisplayNames: { ...state.playerDisplayNames, [imageSubject]: displayName },
      }));
      // Rewrite the reference everywhere (labels, MG text, captions). Undoable.
      mutate((events) => {
        const next = applyDisplayNameToEvents(events, prev, displayName);
        return next === events ? null : next;
      });
    },

    toggleEvent: (id) =>
      mutate((events) => {
        let changed = false;
        const next = events.map((e) => {
          if (e.id !== id) return e;
          changed = true;
          return { ...e, enabled: !e.enabled }; // locked clips may still toggle
        });
        return changed ? next : null;
      }),

    updateEvent: (id, edit) =>
      mutate((events) => {
        const target = events.find((e) => e.id === id);
        if (!target || target.locked) return null; // locked: position/size frozen
        return events.map((e) => {
          if (e.id !== id) return e;
          const {
            overlayData: overlayEdit,
            shortData: shortEdit,
            chapterData: chapterEdit,
            captionData: captionEdit,
            ...rest
          } = edit;
          const merged: TimelineEvent = { ...e, ...rest };
          if (overlayEdit && e.overlayData) {
            merged.overlayData = { ...e.overlayData, ...overlayEdit };
          }
          if (shortEdit && e.shortData) {
            merged.shortData = { ...e.shortData, ...shortEdit };
          }
          if (chapterEdit && e.chapterData) {
            merged.chapterData = { ...e.chapterData, ...chapterEdit };
          }
          if (captionEdit && e.captionData) {
            merged.captionData = { ...e.captionData, ...captionEdit };
          }
          return merged;
        });
      }),

    resolveReview: (id) =>
      mutate((events) => {
        let changed = false;
        const next = events.map((e) => {
          if (e.id !== id || !e.reviewRequired) return e;
          changed = true;
          return { ...e, reviewRequired: false };
        });
        return changed ? next : null;
      }),

    addEvent: (event) => mutate((events) => [...events, event]),

    removeEvent: (id) =>
      mutate((events) => {
        const target = events.find((e) => e.id === id);
        // Cuts are toggled off, never deleted; locked clips can't be removed.
        if (!target || target.locked || target.kind === "cut") return null;
        return events.filter((e) => e.id !== id);
      }),

    // Build status is system-derived (the build pipeline reporting progress),
    // not a user edit — so it does NOT record undo history. This keeps the undo
    // stack clean while many motion graphics build in the background, and stops
    // a stray Ctrl+Z from reverting a finished graphic to "pending".
    setMotionGraphicBuildStatus: (id, status, assetPath) =>
      set((state) => {
        const target = state.events.find((e) => e.id === id);
        if (!target || !target.motionGraphicData) return state;
        return {
          events: state.events.map((e) =>
            e.id === id && e.motionGraphicData
              ? {
                  ...e,
                  motionGraphicData: { ...e.motionGraphicData, buildStatus: status },
                  overlayData:
                    assetPath && e.overlayData ? { ...e.overlayData, assetPath } : e.overlayData,
                }
              : e,
          ),
        };
      }),

    setImageOverlayAssetPaths: (pathByAssetId) =>
      set((state) => {
        let changed = false;
        const events = state.events.map((e) => {
          if (e.kind !== "image" || !e.overlayData) return e;
          const path = pathByAssetId[e.overlayData.assetId];
          if (!path || path === e.overlayData.assetPath) return e;
          changed = true;
          return { ...e, overlayData: { ...e.overlayData, assetPath: path } };
        });
        return changed ? { events } : state;
      }),

    updateMotionGraphicParams: (id, params) =>
      mutate((events) => {
        const target = events.find((e) => e.id === id);
        if (!target || !target.motionGraphicData) return null;
        return events.map((e) => {
          if (e.id !== id || !e.motionGraphicData) return e;
          return {
            ...e,
            motionGraphicData: { ...e.motionGraphicData, params: { ...params } },
          };
        });
      }),

    setCaptions: (segments) =>
      mutate((events) => {
        const withoutCaptions = events.filter((e) => e.kind !== "caption");
        const captions = segments.map((s) => captionToEvent({ ...s, id: s.id ?? nextCaptionId() }));
        return [...withoutCaptions, ...captions];
      }),

    splitCaption: (id, charIndex) =>
      mutate((events) => {
        const target = events.find((e) => e.id === id && e.kind === "caption");
        if (!target) return null;
        const [a, b] = splitCaptionSegment(eventToCaptionSegment(target), charIndex);
        // Replace the one caption event with two, preserving position.
        return events.flatMap((e) =>
          e.id === id
            ? [
                captionToEvent({ ...a, id: nextCaptionId() }),
                captionToEvent({ ...b, id: nextCaptionId() }),
              ]
            : [e],
        );
      }),

    mergeCaptions: (idA, idB) =>
      mutate((events) => {
        const a = events.find((e) => e.id === idA && e.kind === "caption");
        const b = events.find((e) => e.id === idB && e.kind === "caption");
        if (!a || !b) return null;
        const merged = captionToEvent({
          ...mergeCaptionSegments(eventToCaptionSegment(a), eventToCaptionSegment(b)),
          id: nextCaptionId(),
        });
        // Put the merged caption where the earlier one was; drop the other.
        const firstId = a.start <= b.start ? idA : idB;
        const dropId = firstId === idA ? idB : idA;
        return events.flatMap((e) => (e.id === firstId ? [merged] : e.id === dropId ? [] : [e]));
      }),

    approve: () =>
      set((state) => {
        if (state.approved) return state;
        if (state.events.some((e) => e.reviewRequired)) return state; // gated
        return { ...state, approved: true, past: [...state.past, snapshot(state)], future: [] };
      }),

    unapprove: () =>
      set((state) => {
        if (!state.approved) return state;
        return { ...state, approved: false, past: [...state.past, snapshot(state)], future: [] };
      }),

    undo: () =>
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return state;
        return {
          ...state,
          events: previous.events,
          keepSegments: previous.keepSegments,
          approved: previous.approved,
          past: state.past.slice(0, -1),
          future: [snapshot(state), ...state.future],
        };
      }),

    redo: () =>
      set((state) => {
        const nextSnap = state.future[0];
        if (!nextSnap) return state;
        return {
          ...state,
          events: nextSnap.events,
          keepSegments: nextSnap.keepSegments,
          approved: nextSnap.approved,
          past: [...state.past, snapshot(state)],
          future: state.future.slice(1),
        };
      }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    unresolvedReviewCount: () => get().events.filter((e) => e.reviewRequired).length,
    canApprove: () => !get().approved && get().unresolvedReviewCount() === 0,
  };
});
