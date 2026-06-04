import { describe, expect, it } from "vitest";
import { EditListSchema } from "./editListParser";
import { buildTimeline } from "./timelineBuilder";
import sweetRelief from "./__fixtures__/sweet-relief.json";

const editList = EditListSchema.parse(sweetRelief);

describe("buildTimeline", () => {
  it("produces 26 cut events from 26 cuts", () => {
    const { events } = buildTimeline(editList);
    expect(events.filter((e) => e.kind === "cut")).toHaveLength(26);
  });

  it("uses remove_duration_seconds and locked_against_gpt_override for cuts", () => {
    const { events } = buildTimeline(editList);
    const cut1 = events.find((e) => e.id === "cut_001")!;
    expect(cut1.duration).toBeCloseTo(1.1, 5); // remove_duration_seconds
    expect(cut1.cutData?.silenceDurationSeconds).toBeCloseTo(1.6, 5);
    expect(cut1.locked).toBe(false);
  });

  it("creates motion graphic events with buildStatus 'pending'", () => {
    const { events } = buildTimeline(editList);
    const mgEvents = events.filter((e) => e.kind === "motion_graphic");
    expect(mgEvents).toHaveLength(2);
    for (const e of mgEvents) {
      expect(e.motionGraphicData?.buildStatus).toBe("pending");
      expect(e.overlayData?.assetPath).toBe(""); // not built yet
    }
  });

  it("derives motion graphic duration, template, and label from the overlay", () => {
    const { events } = buildTimeline(editList);
    const quote = events.find((e) => e.id === "overlay_001")!;
    expect(quote.duration).toBe(2);
    expect(quote.label).toBe("Sweet Relief");
    expect(quote.motionGraphicData?.templateId).toBe("quote_card");
  });

  it("keep segments cover the full non-cut duration", () => {
    const { events, keepSegments } = buildTimeline(editList);
    const totalRemoved = events
      .filter((e) => e.kind === "cut" && e.enabled)
      .reduce((sum, e) => sum + e.duration, 0);
    const keptDuration = keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0);

    expect(keptDuration).toBeCloseTo(editList.metadata.duration_seconds - totalRemoved, 5);

    // Segments tile the timeline: sorted, non-overlapping, within [0, duration].
    expect(keepSegments[0].start).toBe(0);
    expect(keepSegments[keepSegments.length - 1].end).toBeCloseTo(
      editList.metadata.duration_seconds,
      5,
    );
    for (let i = 1; i < keepSegments.length; i++) {
      expect(keepSegments[i].start).toBeGreaterThanOrEqual(keepSegments[i - 1].end);
    }
  });

  it("maps chapters, shorts, transitions, and motion graphics onto their tracks", () => {
    const { events } = buildTimeline(editList);
    expect(events.filter((e) => e.kind === "chapter")).toHaveLength(9);
    expect(events.filter((e) => e.kind === "short_in")).toHaveLength(4);
    expect(events.filter((e) => e.kind === "motion_graphic")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "transition")).toHaveLength(1);
  });

  it("flags every placeholder chapter title and short hook for review", () => {
    const { events } = buildTimeline(editList);
    // All 9 chapters are "Segment NN" placeholders; all 4 shorts are
    // [TRANSCRIPT_REQUIRED] → 13 review items, no cuts.
    const chaptersNeedingReview = events.filter(
      (e) => e.kind === "chapter" && e.reviewRequired,
    );
    const shortsNeedingReview = events.filter((e) => e.kind === "short_in" && e.reviewRequired);
    expect(chaptersNeedingReview).toHaveLength(9);
    expect(shortsNeedingReview).toHaveLength(4);
    expect(events.filter((e) => e.kind === "cut" && e.reviewRequired)).toHaveLength(0);
  });

  it("builds image overlay events from player_image_overlays, linked by assetId", () => {
    const withPlayers = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 100 },
      longform: { cuts: [] },
      shorts: [],
      player_image_overlays: [
        {
          image_subject: "Mathys Tel",
          image_type: "action",
          overlay_id: "pio_1",
          time: "00:20.0",
          duration_seconds: 6,
          placement: "right_center",
          text: "Tel scores",
        },
        // No time → upload-slot hint only, produces no timeline event.
        { image_subject: "Son Heung-min", image_type: "portrait" },
      ],
    });
    const images = buildTimeline(withPlayers).events.filter((e) => e.kind === "image");
    expect(images).toHaveLength(1);
    const img = images[0];
    expect(img.id).toBe("pio_1");
    expect(img.start).toBe(20);
    expect(img.duration).toBe(6);
    expect(img.label).toBe("Tel scores");
    expect(img.track).toBe(100); // TRACK.imageOverlayBase — own row per overlay
    expect(img.overlayData?.placement).toBe("right_center"); // explicit kept
    expect(img.overlayData?.assetPath).toBe(""); // not collected yet
    // assetId must match the onboarding slot id for the same (subject, role).
    expect(img.overlayData?.assetId).toBe("asset_mathys-tel_action");
  });

  it("accepts appear_time/appear_duration_seconds (the customGPT field names)", () => {
    const withPlayers = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 1000 },
      longform: { cuts: [] },
      shorts: [],
      player_image_overlays: [
        {
          image_subject: "Micky van de Ven",
          image_type: "action",
          overlay_id: "pio_2",
          appear_time: "00:03:43.750",
          appear_duration_seconds: 4.5,
          placement: "left_center",
        },
      ],
    });
    const img = buildTimeline(withPlayers).events.find((e) => e.kind === "image")!;
    expect(img.start).toBeCloseTo(223.75, 3); // 3*60 + 43.75
    expect(img.duration).toBe(4.5);
    expect(img.overlayData?.placement).toBe("left_center");
    expect(img.overlayData?.assetId).toBe("asset_micky-van-de-ven_action");
  });

  it("carries fade_in/out durations onto the image overlay", () => {
    const withFades = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 100 },
      longform: { cuts: [] },
      shorts: [],
      player_image_overlays: [
        {
          image_subject: "Son Heung-min",
          image_type: "celebration",
          appear_time: "00:30.0",
          appear_duration_seconds: 8,
          fade_in_duration_seconds: 0.5,
          fade_out_duration_seconds: 0.5,
        },
      ],
    });
    const img = buildTimeline(withFades).events.find((e) => e.kind === "image")!;
    expect(img.overlayData?.fadeInSeconds).toBe(0.5);
    expect(img.overlayData?.fadeOutSeconds).toBe(0.5);
  });

  it("leaves fades undefined when the overlay omits them (hard cut)", () => {
    const noFades = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 100 },
      longform: { cuts: [] },
      shorts: [],
      player_image_overlays: [{ image_subject: "Archie Gray", appear_time: "00:05.0" }],
    });
    const img = buildTimeline(noFades).events.find((e) => e.kind === "image")!;
    expect(img.overlayData?.fadeInSeconds).toBeUndefined();
    expect(img.overlayData?.fadeOutSeconds).toBeUndefined();
  });

  it("defaults image overlay duration and placement when the overlay omits them", () => {
    const withPlayers = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 100 },
      longform: { cuts: [] },
      shorts: [],
      player_image_overlays: [{ image_subject: "Archie Gray", time: "00:05.0" }],
    });
    const img = buildTimeline(withPlayers).events.find((e) => e.kind === "image")!;
    expect(img.duration).toBe(5); // DEFAULT_IMAGE_DURATION_SECONDS
    expect(img.overlayData?.placement).toBe("top_left"); // no placement → first quadrant
    expect(img.overlayData?.assetId).toBe("asset_archie-gray_image"); // default role
  });

  it("spreads placement-less player images across the four-quadrant grid on their own rows", () => {
    const withPlayers = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 100 },
      longform: { cuts: [] },
      shorts: [],
      player_image_overlays: [
        { image_subject: "A", appear_time: "00:05.0" },
        { image_subject: "B", appear_time: "00:06.0" },
        { image_subject: "C", appear_time: "00:07.0" },
        { image_subject: "D", appear_time: "00:08.0" },
      ],
    });
    const imgs = buildTimeline(withPlayers).events.filter((e) => e.kind === "image");
    expect(imgs.map((e) => e.overlayData?.placement)).toEqual([
      "top_left", "top_right", "bottom_left", "bottom_right",
    ]);
    // Each on its own track (row), and distinct centre points (not stacked).
    expect(new Set(imgs.map((e) => e.track)).size).toBe(4);
    expect(new Set(imgs.map((e) => `${e.overlayData?.x},${e.overlayData?.y}`)).size).toBe(4);
  });

  it("derives a cut's duration from end-start when remove_duration_seconds is absent", () => {
    const minimal = EditListSchema.parse({
      project_name: "x",
      metadata: { duration_seconds: 100 },
      longform: {
        cuts: [{ cut_id: "c1", start_time: "00:10.0", end_time: "00:13.5" }], // no remove_duration_seconds
      },
      shorts: [],
    });
    const cut = buildTimeline(minimal).events.find((e) => e.id === "c1")!;
    expect(cut.duration).toBe(3.5);
  });
});
