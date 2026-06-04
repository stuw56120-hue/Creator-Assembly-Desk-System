import { describe, expect, it } from "vitest";
import { partitionLiveAssets } from "./cleanLibrary";

// A tiny in-memory filesystem: only these absolute paths "exist".
function fsWith(...present: string[]) {
  const set = new Set(present);
  return (p: string) => set.has(p);
}
const resolveFromRoot = (rel: string) => `/lib/${rel}`;

describe("partitionLiveAssets", () => {
  it("keeps an asset whose absolutePath exists", () => {
    const assets = [{ id: "a", absolutePath: "/lib/images/a.png", relativePath: "images/a.png" }];
    const { kept, removed } = partitionLiveAssets(assets, fsWith("/lib/images/a.png"), resolveFromRoot);
    expect(kept).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  it("removes an asset whose file is missing", () => {
    const assets = [{ id: "gone", absolutePath: "/lib/images/gone.png", relativePath: "images/gone.png" }];
    const { kept, removed } = partitionLiveAssets(assets, fsWith(), resolveFromRoot);
    expect(kept).toHaveLength(0);
    expect(removed.map((a) => a.id)).toEqual(["gone"]);
  });

  it("falls back to relativePath resolved against the library root", () => {
    // absolutePath is stale (library moved) but the file exists at the resolved relative path.
    const assets = [{ id: "moved", absolutePath: "C:/old/images/m.png", relativePath: "images/m.png" }];
    const { kept, removed } = partitionLiveAssets(assets, fsWith("/lib/images/m.png"), resolveFromRoot);
    expect(kept.map((a) => a.id)).toEqual(["moved"]);
    expect(removed).toHaveLength(0);
  });

  it("treats an asset with no usable path as an orphan", () => {
    const assets = [{ id: "empty" }, { id: "blank", absolutePath: "", relativePath: "" }];
    const { kept, removed } = partitionLiveAssets(assets, fsWith(), resolveFromRoot);
    expect(kept).toHaveLength(0);
    expect(removed.map((a) => a.id)).toEqual(["empty", "blank"]);
  });

  it("partitions a mixed list, preserving order within each bucket", () => {
    const assets = [
      { id: "live1", absolutePath: "/lib/images/1.png" },
      { id: "dead1", absolutePath: "/lib/images/x.png" },
      { id: "live2", relativePath: "motion_graphics/mg.webm" },
      { id: "dead2", absolutePath: "/lib/images/y.png", relativePath: "images/y.png" },
    ];
    const { kept, removed } = partitionLiveAssets(
      assets,
      fsWith("/lib/images/1.png", "/lib/motion_graphics/mg.webm"),
      resolveFromRoot,
    );
    expect(kept.map((a) => a.id)).toEqual(["live1", "live2"]);
    expect(removed.map((a) => a.id)).toEqual(["dead1", "dead2"]);
  });
});
