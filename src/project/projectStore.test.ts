import { beforeEach, describe, expect, it } from "vitest";
import { EditListSchema } from "./editListParser";
import { buildTimeline } from "./timelineBuilder";
import { useProjectStore } from "./projectStore";
import sweetRelief from "./__fixtures__/sweet-relief.json";

const editList = EditListSchema.parse(sweetRelief);

function loadFixture() {
  const { events, keepSegments } = buildTimeline(editList);
  useProjectStore.getState().loadTimeline({
    projectName: editList.project_name,
    durationSeconds: editList.metadata.duration_seconds,
    events,
    keepSegments,
  });
}

const keptDuration = () =>
  useProjectStore.getState().keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0);

describe("useProjectStore", () => {
  beforeEach(loadFixture);

  it("loads the timeline and clears history/approval", () => {
    const state = useProjectStore.getState();
    expect(state.projectName).toBe("Sweet Relief");
    expect(state.events.filter((e) => e.kind === "cut")).toHaveLength(26);
    expect(state.approved).toBe(false);
    expect(state.canUndo()).toBe(false);
    expect(state.canRedo()).toBe(false);
  });

  describe("setPlayerDisplayName", () => {
    it("stores the name and rewrites the player reference across events", () => {
      // Seed a known reference into a chapter label and the display-name map.
      const store = useProjectStore.getState();
      store.setPlayerDisplayNames({ matis_tel: "Matis Tel" });
      const chapter = store.events.find((e) => e.kind === "chapter" && !e.locked);
      if (chapter) {
        store.updateEvent(chapter.id, { label: "matis_tel's goal" });
      }

      useProjectStore.getState().setPlayerDisplayName("matis_tel", "Mathis Tel");

      expect(useProjectStore.getState().playerDisplayNames.matis_tel).toBe("Mathis Tel");
      if (chapter) {
        const updated = useProjectStore.getState().events.find((e) => e.id === chapter.id)!;
        expect(updated.label).toBe("Mathis Tel's goal");
      }
    });
  });

  describe("setImageOverlayAssetPaths", () => {
    const withImage = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 100 },
      longform: { cuts: [] },
      shorts: [],
      player_image_overlays: [
        { image_subject: "Mathys Tel", image_type: "action", overlay_id: "pio_1", time: "00:20.0" },
      ],
    });

    it("fills the matching image overlay's assetPath without recording undo history", () => {
      const built = buildTimeline(withImage);
      useProjectStore.getState().loadTimeline({
        projectName: "x",
        durationSeconds: 100,
        events: built.events,
        keepSegments: built.keepSegments,
      });

      useProjectStore.getState().setImageOverlayAssetPaths({
        "asset_mathys-tel_action": "C:/lib/tel-action/original.png",
        "asset_unused_role": "C:/lib/other.png",
      });

      const img = useProjectStore.getState().events.find((e) => e.id === "pio_1")!;
      expect(img.overlayData?.assetPath).toBe("C:/lib/tel-action/original.png");
      // System-derived link, not a user edit → stays out of the undo stack.
      expect(useProjectStore.getState().canUndo()).toBe(false);
    });
  });

  describe("toggleEvent", () => {
    it("disabling a cut restores its removed span to the keep segments", () => {
      const before = keptDuration();
      const cut = useProjectStore.getState().events.find((e) => e.id === "cut_001")!;
      useProjectStore.getState().toggleEvent("cut_001");

      expect(useProjectStore.getState().events.find((e) => e.id === "cut_001")!.enabled).toBe(
        false,
      );
      expect(keptDuration()).toBeCloseTo(before + cut.duration, 5);
    });

    it("is undoable and redoable", () => {
      const before = keptDuration();
      useProjectStore.getState().toggleEvent("cut_001");
      const afterToggle = keptDuration();
      expect(useProjectStore.getState().canUndo()).toBe(true);

      useProjectStore.getState().undo();
      expect(keptDuration()).toBeCloseTo(before, 5);
      expect(useProjectStore.getState().events.find((e) => e.id === "cut_001")!.enabled).toBe(true);

      useProjectStore.getState().redo();
      expect(keptDuration()).toBeCloseTo(afterToggle, 5);
    });
  });

  describe("updateEvent", () => {
    it("moves an unlocked motion graphic and records history", () => {
      useProjectStore.getState().updateEvent("overlay_001", { start: 99 });
      expect(useProjectStore.getState().events.find((e) => e.id === "overlay_001")!.start).toBe(99);
      expect(useProjectStore.getState().canUndo()).toBe(true);
    });

    it("refuses to move a locked clip", () => {
      const events = useProjectStore
        .getState()
        .events.map((e) => (e.id === "overlay_001" ? { ...e, locked: true } : e));
      useProjectStore.getState().loadTimeline({
        projectName: "x",
        durationSeconds: editList.metadata.duration_seconds,
        events,
        keepSegments: useProjectStore.getState().keepSegments,
      });
      const startBefore = useProjectStore.getState().events.find((e) => e.id === "overlay_001")!
        .start;
      useProjectStore.getState().updateEvent("overlay_001", { start: 5 });
      expect(useProjectStore.getState().events.find((e) => e.id === "overlay_001")!.start).toBe(
        startBefore,
      );
      expect(useProjectStore.getState().canUndo()).toBe(false); // no-op, nothing recorded
    });
  });

  describe("removeEvent", () => {
    it("removes an unlocked overlay", () => {
      useProjectStore.getState().removeEvent("overlay_002");
      expect(useProjectStore.getState().events.find((e) => e.id === "overlay_002")).toBeUndefined();
    });

    it("never deletes a cut (toggled off, not removed)", () => {
      useProjectStore.getState().removeEvent("cut_001");
      expect(useProjectStore.getState().events.find((e) => e.id === "cut_001")).toBeDefined();
      expect(useProjectStore.getState().canUndo()).toBe(false);
    });
  });

  describe("motion graphic build status", () => {
    it("updates build status and asset path without recording undo history", () => {
      // Build status is system-derived, not a user edit — it must not pollute the
      // undo stack (auto-building many MGs would otherwise flood it).
      expect(useProjectStore.getState().canUndo()).toBe(false);
      useProjectStore
        .getState()
        .setMotionGraphicBuildStatus("overlay_001", "ready", "/lib/overlay_001.webm");
      const mg = useProjectStore.getState().events.find((e) => e.id === "overlay_001")!;
      expect(mg.motionGraphicData!.buildStatus).toBe("ready");
      expect(mg.overlayData!.assetPath).toBe("/lib/overlay_001.webm");
      expect(useProjectStore.getState().canUndo()).toBe(false);
    });
  });

  describe("approval gating", () => {
    it("blocks approval until every review item is resolved", () => {
      const store = useProjectStore.getState();
      // Real fixture: 9 placeholder chapters + 4 placeholder short hooks = 13.
      expect(store.unresolvedReviewCount()).toBe(13);
      expect(store.canApprove()).toBe(false);

      store.approve();
      expect(useProjectStore.getState().approved).toBe(false); // gated

      const reviewIds = useProjectStore
        .getState()
        .events.filter((e) => e.reviewRequired)
        .map((e) => e.id);
      for (const id of reviewIds) useProjectStore.getState().resolveReview(id);

      expect(useProjectStore.getState().unresolvedReviewCount()).toBe(0);
      expect(useProjectStore.getState().canApprove()).toBe(true);

      useProjectStore.getState().approve();
      expect(useProjectStore.getState().approved).toBe(true);
    });

    it("can unapprove and undo back to the approved state", () => {
      const reviewIds = useProjectStore
        .getState()
        .events.filter((e) => e.reviewRequired)
        .map((e) => e.id);
      for (const id of reviewIds) useProjectStore.getState().resolveReview(id);
      useProjectStore.getState().approve();
      expect(useProjectStore.getState().approved).toBe(true);

      useProjectStore.getState().unapprove();
      expect(useProjectStore.getState().approved).toBe(false);

      useProjectStore.getState().undo();
      expect(useProjectStore.getState().approved).toBe(true);
    });
  });

  describe("captions", () => {
    const captions = () =>
      useProjectStore.getState().events.filter((e) => e.kind === "caption");

    it("setCaptions replaces the caption track and is undoable", () => {
      useProjectStore.getState().setCaptions([
        { start: 1, end: 3, speaker: "Stuart", text: "hello there" },
        { start: 3, end: 5, speaker: "", text: "second caption" },
      ]);
      expect(captions()).toHaveLength(2);
      // Replacing again swaps them out, not appends.
      useProjectStore.getState().setCaptions([{ start: 0, end: 2, speaker: "", text: "only one" }]);
      expect(captions()).toHaveLength(1);
      expect(captions()[0].captionData?.text).toBe("only one");

      useProjectStore.getState().undo();
      expect(captions()).toHaveLength(2);
    });

    it("editing a caption updates captionData via updateEvent", () => {
      useProjectStore.getState().setCaptions([{ start: 1, end: 3, speaker: "Stuart", text: "Kuluseski" }]);
      const id = captions()[0].id;
      useProjectStore.getState().updateEvent(id, {
        label: "Kulusevski",
        captionData: { text: "Kulusevski" },
      });
      const c = captions()[0];
      expect(c.captionData?.text).toBe("Kulusevski");
      expect(c.captionData?.speaker).toBe("Stuart"); // preserved
      expect(c.label).toBe("Kulusevski");
    });

    it("splits a caption into two at a character index", () => {
      useProjectStore.getState().setCaptions([{ start: 10, end: 14, speaker: "S", text: "hello there world" }]);
      const id = captions()[0].id;
      useProjectStore.getState().splitCaption(id, 6);
      const cc = captions();
      expect(cc).toHaveLength(2);
      expect(cc[0].captionData?.text).toBe("hello");
      expect(cc[1].captionData?.text).toBe("there world");
      expect(cc[0].start).toBe(10);
      expect(cc[1].start + cc[1].duration).toBeCloseTo(14, 3);
    });

    it("merges two adjacent captions into one", () => {
      useProjectStore.getState().setCaptions([
        { start: 10, end: 12, speaker: "S", text: "First part" },
        { start: 12, end: 15, speaker: "", text: "second part" },
      ]);
      const [a, b] = captions();
      useProjectStore.getState().mergeCaptions(a.id, b.id);
      const cc = captions();
      expect(cc).toHaveLength(1);
      expect(cc[0].captionData?.text).toBe("First part second part");
      expect(cc[0].start).toBe(10);
      expect(cc[0].start + cc[0].duration).toBeCloseTo(15, 3);
    });

    it("deletes a caption via removeEvent", () => {
      useProjectStore.getState().setCaptions([
        { start: 1, end: 2, speaker: "", text: "keep" },
        { start: 2, end: 3, speaker: "", text: "drop" },
      ]);
      const dropId = captions().find((c) => c.captionData?.text === "drop")!.id;
      useProjectStore.getState().removeEvent(dropId);
      expect(captions()).toHaveLength(1);
      expect(captions()[0].captionData?.text).toBe("keep");
    });
  });
});
