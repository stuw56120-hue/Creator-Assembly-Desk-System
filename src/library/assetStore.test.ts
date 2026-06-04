import { beforeEach, describe, expect, it } from "vitest";
import {
  assetHasBackground,
  contextualAddAction,
  filterAssets,
  useAssetStore,
  type LibraryAsset,
} from "./assetStore";

describe("assetHasBackground (Fix 3 — bg indicator)", () => {
  const mg = (params?: Record<string, unknown>): Pick<LibraryAsset, "category" | "params"> => ({
    category: "motion_graphic",
    params,
  });
  it("true for an MG with a background_image_id", () => {
    expect(assetHasBackground(mg({ background_image_id: "uuid-123" }))).toBe(true);
  });
  it("true for an MG with a resolved background_image_url", () => {
    expect(assetHasBackground(mg({ background_image_url: "data:image/png;base64,xx" }))).toBe(true);
  });
  it("false for an MG with no background params", () => {
    expect(assetHasBackground(mg({ text: "Quote" }))).toBe(false);
    expect(assetHasBackground(mg(undefined))).toBe(false);
    expect(assetHasBackground(mg({ background_image_id: "" }))).toBe(false);
  });
  it("false for non-motion-graphic assets", () => {
    expect(assetHasBackground({ category: "image", params: { background_image_id: "x" } })).toBe(false);
  });
});

describe("contextualAddAction (Bug 7 — contextual + button)", () => {
  it("dispatches by the open sub-panel", () => {
    expect(contextualAddAction("image")).toEqual({ kind: "image", label: "Add an image" });
    expect(contextualAddAction("meme")).toEqual({ kind: "meme", label: "Add a meme" });
    expect(contextualAddAction("motion_graphic")).toEqual({
      kind: "motion_graphic",
      label: "Create a motion graphic",
    });
  });

  it("falls back to the motion-graphic studio for the 'all' default", () => {
    expect(contextualAddAction("all").kind).toBe("motion_graphic");
  });
});

const assets: LibraryAsset[] = [
  {
    id: "img_1",
    filename: "stadium-wide.png",
    relativePath: "images/stadium-wide.png",
    absolutePath: "/lib/images/stadium-wide.png",
    category: "image",
    tags: ["stadium", "wide"],
    addedAt: "2026-05-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "meme_1",
    filename: "shocked-pepe.png",
    relativePath: "memes/shocked-pepe.png",
    absolutePath: "/lib/memes/shocked-pepe.png",
    category: "meme",
    tags: ["reaction"],
    addedAt: "2026-05-01T00:00:00Z",
    usageCount: 3,
  },
  {
    id: "mg_1",
    filename: "overlay_001.webm",
    relativePath: "motion_graphics/overlay_001.webm",
    absolutePath: "/lib/motion_graphics/overlay_001.webm",
    category: "motion_graphic",
    tags: [],
    addedAt: "2026-05-01T00:00:00Z",
    usageCount: 0,
    templateId: "quote_card",
    params: { text: "Sweet Relief" },
    durationSeconds: 2,
  },
];

describe("filterAssets", () => {
  it("searches by filename", () => {
    const result = filterAssets(assets, "all", "pepe");
    expect(result.map((a) => a.id)).toEqual(["meme_1"]);
  });

  it("searches by tag", () => {
    expect(filterAssets(assets, "all", "stadium").map((a) => a.id)).toEqual(["img_1"]);
  });

  it("filters by category", () => {
    expect(filterAssets(assets, "motion_graphic", "").map((a) => a.id)).toEqual(["mg_1"]);
    expect(filterAssets(assets, "image", "").map((a) => a.id)).toEqual(["img_1"]);
  });

  it("combines category filter and query", () => {
    expect(filterAssets(assets, "meme", "stadium")).toHaveLength(0);
    expect(filterAssets(assets, "image", "wide").map((a) => a.id)).toEqual(["img_1"]);
  });

  it("returns all assets when category is 'all' and query is empty", () => {
    expect(filterAssets(assets, "all", "")).toHaveLength(3);
  });
});

describe("useAssetStore", () => {
  beforeEach(() => {
    useAssetStore.setState({ assets: [], query: "", category: "all" });
  });

  it("exposes visible assets through the store filters", () => {
    useAssetStore.getState().setAssets(assets);
    useAssetStore.getState().setCategory("motion_graphic");
    const visible = useAssetStore.getState().visibleAssets();
    expect(visible).toHaveLength(1);
    expect(visible[0].templateId).toBe("quote_card");
    expect(visible[0].params).toEqual({ text: "Sweet Relief" });
  });

  it("upserts an asset by id", () => {
    useAssetStore.getState().setAssets(assets);
    useAssetStore.getState().upsertAsset({ ...assets[2], usageCount: 9 });
    const mg = useAssetStore.getState().assets.find((a) => a.id === "mg_1");
    expect(mg?.usageCount).toBe(9);
    expect(useAssetStore.getState().assets).toHaveLength(3); // replaced, not appended
  });
});
