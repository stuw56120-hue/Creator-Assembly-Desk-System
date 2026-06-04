import { describe, expect, it } from "vitest";
import { mergeRequiredAssets, requiredAssetsFromPlayerOverlays } from "./playerAssets";
import type { PlayerImageOverlay, RequiredAsset } from "./editListParser";

const overlays: PlayerImageOverlay[] = [
  { image_subject: "Son Heung-min", image_type: "portrait", overlay_id: "pio_001" },
  { image_subject: "Son Heung-min", image_type: "action", overlay_id: "pio_002" },
  { image_subject: "Son Heung-min", image_type: "action", overlay_id: "pio_003" }, // dup role
  { image_subject: "James Maddison", image_type: "celebration", overlay_id: "pio_004" },
  { image_subject: "James Maddison", overlay_id: "pio_005" }, // no role → default "image"
  { overlay_id: "pio_006" }, // no subject → skipped
];

describe("requiredAssetsFromPlayerOverlays", () => {
  it("emits one slot per unique (subject, image_type)", () => {
    const assets = requiredAssetsFromPlayerOverlays(overlays);
    expect(assets.map((a) => a.asset_id)).toEqual([
      "asset_son-heung-min_portrait",
      "asset_son-heung-min_action",
      "asset_james-maddison_celebration",
      "asset_james-maddison_image",
    ]);
  });

  it("groups by image_subject and labels by role", () => {
    const assets = requiredAssetsFromPlayerOverlays(overlays);
    const action = assets.find((a) => a.asset_id === "asset_son-heung-min_action")!;
    expect(action.image_subject).toBe("Son Heung-min");
    expect(action.image_type).toBe("action");
    expect(action.purpose).toBe("Action image of Son Heung-min");
    expect(action.suggested_filename).toBe("son-heung-min-action");
    // both overlays for that role collected
    expect(action.used_in).toEqual(["pio_002", "pio_003"]);
  });

  it("skips overlays without an image_subject", () => {
    const assets = requiredAssetsFromPlayerOverlays(overlays);
    expect(assets.every((a) => a.used_in.indexOf("pio_006") === -1)).toBe(true);
  });

  it("reads the role from alternative field names", () => {
    const assets = requiredAssetsFromPlayerOverlays([
      { image_subject: "Kulusevski", shot_type: "Action" } as PlayerImageOverlay,
    ]);
    expect(assets[0].asset_id).toBe("asset_kulusevski_action");
    expect(assets[0].image_type).toBe("action");
  });

  it("marks a slot optional only when every feeding overlay is optional", () => {
    const assets = requiredAssetsFromPlayerOverlays([
      { image_subject: "A", image_type: "portrait", overlay_id: "x", optional: true },
      { image_subject: "B", image_type: "portrait", overlay_id: "y", optional: true },
      { image_subject: "B", image_type: "portrait", overlay_id: "z", optional: false },
    ]);
    expect(assets.find((a) => a.image_subject === "A")!.optional).toBe(true);
    expect(assets.find((a) => a.image_subject === "B")!.optional).toBe(false);
  });
});

describe("mergeRequiredAssets", () => {
  it("appends derived slots, explicit entries win on id collision", () => {
    const explicit: RequiredAsset[] = [
      { asset_id: "asset_logo", purpose: "Logo", suggested_filename: "logo", used_in: [], optional: false },
      { asset_id: "asset_son-heung-min_portrait", purpose: "Custom", suggested_filename: "x", used_in: [], optional: false },
    ];
    const derived = requiredAssetsFromPlayerOverlays(overlays);
    const merged = mergeRequiredAssets(explicit, derived);
    // explicit asset_son-heung-min_portrait kept (not duplicated)
    expect(merged.filter((a) => a.asset_id === "asset_son-heung-min_portrait")).toHaveLength(1);
    expect(merged.find((a) => a.asset_id === "asset_son-heung-min_portrait")!.purpose).toBe("Custom");
    expect(merged[0].asset_id).toBe("asset_logo");
  });
});
