import { describe, expect, it } from "vitest";
import { parseEditList, type TemplateRegistry } from "./editListParser";
import { testRegistry } from "./__fixtures__/testRegistry";
import sweetRelief from "./__fixtures__/sweet-relief.json";

/** Deep clone the fixture so a test can mutate it without affecting others. */
function freshFixture(): Record<string, unknown> {
  return structuredClone(sweetRelief) as Record<string, unknown>;
}

/** Reach into longform.motion_overlays of a cloned fixture. */
function overlaysOf(fixture: Record<string, unknown>): Record<string, unknown>[] {
  return (fixture.longform as { motion_overlays: Record<string, unknown>[] }).motion_overlays;
}

describe("parseEditList", () => {
  it("parses the real Sweet Relief fixture cleanly", () => {
    const result = parseEditList(sweetRelief, testRegistry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.editList.project_name).toBe("Sweet Relief");
    expect(result.editList.metadata.duration_seconds).toBeCloseTo(2528.021, 3);
    expect(result.editList.longform.cuts).toHaveLength(26);
    expect(result.editList.longform.chapters).toHaveLength(9);
    expect(result.editList.longform.motion_overlays).toHaveLength(2);
    expect(result.editList.shorts).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });

  it("queues a build job for every long-form motion graphic", () => {
    const result = parseEditList(sweetRelief, testRegistry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.buildQueue).toHaveLength(2);
    expect(result.buildQueue.map((j) => j.mgId)).toEqual(["overlay_001", "overlay_002"]);
    expect(result.buildQueue.map((j) => j.templateId)).toEqual(["quote_card", "subscribe_flash"]);
  });

  it("flattens overlay content into params and exposes duration", () => {
    const result = parseEditList(sweetRelief, testRegistry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quote = result.buildQueue[0];
    expect(quote.params.text).toBe("Sweet Relief");
    expect(quote.params.placement).toBe("center");
    expect(quote.params.duration).toBe(2); // from duration_seconds
  });

  it("applies template defaults for omitted optional params", () => {
    const result = parseEditList(sweetRelief, testRegistry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // overlay_001 (quote_card) omits accent_colour → default filled.
    expect(result.buildQueue[0].params.accent_colour).toBe("#00c2ff");
  });

  it("skips an unknown motion_graphic_id with a warning (partial import, not a failure)", () => {
    const fixture = freshFixture();
    overlaysOf(fixture)[0].motion_graphic_id = "does_not_exist"; // was overlay_001 (quote_card)

    const result = parseEditList(fixture, testRegistry);
    expect(result.ok).toBe(true); // import still succeeds
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('unknown motion graphic template "does_not_exist"'))).toBe(
      true,
    );
    // The unknown overlay is dropped from the build queue and the timeline.
    expect(result.buildQueue.map((j) => j.mgId)).toEqual(["overlay_002"]);
    expect(result.editList.longform.motion_overlays.map((o) => o.overlay_id)).toEqual(["overlay_002"]);
  });

  it("skips a motion graphic with a missing required param (warning, not failure)", () => {
    const strict: TemplateRegistry = {
      ...testRegistry,
      quote_card: {
        ...testRegistry.quote_card,
        params: { ...testRegistry.quote_card.params, headline: { type: "string", required: true } },
      },
    };
    const result = parseEditList(sweetRelief, strict);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('missing required param "headline"'))).toBe(true);
    // quote_card overlay skipped; subscribe_flash still queued.
    expect(result.buildQueue.map((j) => j.templateId)).toEqual(["subscribe_flash"]);
  });

  it("skips a motion graphic with an out-of-range enum value (warning, not failure)", () => {
    const fixture = freshFixture();
    const overlay = overlaysOf(fixture)[0];
    overlay.motion_graphic_id = "topic_banner";
    overlay.animation_in = "explode";

    const result = parseEditList(fixture, testRegistry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('param "animation_in"'))).toBe(true);
  });

  it("reports a structural error for malformed input (still a hard failure)", () => {
    const result = parseEditList({ longform: {} }, testRegistry); // missing project_name, metadata
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects an invalid timecode in a cut", () => {
    const fixture = freshFixture();
    (fixture.longform as { cuts: { start_time: string }[] }).cuts[0].start_time = "garbage";
    const result = parseEditList(fixture, testRegistry);
    expect(result.ok).toBe(false);
  });

  describe("required_assets (Asset Onboarding addendum)", () => {
    it("defaults required_assets to [] for the legacy Sweet Relief fixture", () => {
      const result = parseEditList(sweetRelief, testRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.editList.required_assets).toEqual([]);
    });

    it("parses a required_assets array and its optional flag", () => {
      const fixture = freshFixture();
      fixture.required_assets = [
        {
          asset_id: "asset_headshot",
          purpose: "Your headshot — lower-third background",
          suggested_filename: "headshot",
          used_in: ["overlay_003", "overlay_007"],
          optional: false,
        },
        {
          asset_id: "asset_bg_scene",
          purpose: "B-roll background",
          suggested_filename: "background-scene",
          // used_in + optional omitted → defaults
        },
      ];

      const result = parseEditList(fixture, testRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.editList.required_assets).toHaveLength(2);
      expect(result.editList.required_assets[0]).toMatchObject({
        asset_id: "asset_headshot",
        optional: false,
        used_in: ["overlay_003", "overlay_007"],
      });
      // defaults applied
      expect(result.editList.required_assets[1].optional).toBe(false);
      expect(result.editList.required_assets[1].used_in).toEqual([]);
    });
  });

  describe("tolerant normalisation of customGPT output variants", () => {
    // A reasonable-but-non-canonical edit list: no metadata, cuts without
    // remove_duration_seconds, overlays using template_id + duration (timecode
    // and number).
    function variant() {
      return {
        project_name: "Variant",
        // no metadata block at all
        longform: {
          cuts: [{ cut_id: "c1", type: "dead_air_trim", start_time: "00:01.0", end_time: "00:03.5" }],
          motion_overlays: [
            { overlay_id: "o1", time: "00:00.0", template_id: "quote_card", text: "Hi", duration: "00:02.0" },
            { overlay_id: "o2", time: "00:05.0", template_id: "subscribe_flash", duration: 1.5 },
          ],
        },
        shorts: [],
      };
    }

    it("synthesises metadata with a derived duration when absent", () => {
      const result = parseEditList(variant(), testRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Latest end: o2 at 5s + 1.5s = 6.5s.
      expect(result.editList.metadata.duration_seconds).toBe(6.5);
    });

    it("derives remove_duration_seconds from start/end on cuts", () => {
      const result = parseEditList(variant(), testRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.editList.longform.cuts[0].remove_duration_seconds).toBe(2.5);
    });

    it("accepts template_id as motion_graphic_id and duration as duration_seconds", () => {
      const result = parseEditList(variant(), testRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [o1, o2] = result.editList.longform.motion_overlays;
      expect(o1.motion_graphic_id).toBe("quote_card");
      expect(o1.duration_seconds).toBe(2); // "00:02.0" timecode → 2s
      expect(o2.motion_graphic_id).toBe("subscribe_flash");
      expect(o2.duration_seconds).toBe(1.5); // numeric duration
      // Build queue formed, alias fields kept out of params.
      expect(result.buildQueue).toHaveLength(2);
      expect(result.buildQueue[0].params.text).toBe("Hi");
      expect(result.buildQueue[0].params.duration).toBe(2);
      expect(result.buildQueue[0].params.template_id).toBeUndefined();
    });

    it("leaves a canonical fixture unchanged (normalisation is idempotent)", () => {
      const result = parseEditList(sweetRelief, testRegistry);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.editList.metadata.duration_seconds).toBeCloseTo(2528.021, 3);
      expect(result.buildQueue).toHaveLength(2);
    });
  });
});
