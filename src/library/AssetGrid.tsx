/*
 * Searchable grid of library assets (the visible subset per the active filter).
 */

import { AssetCard } from "./AssetCard";
import type { LibraryAsset } from "./assetStore";

export function AssetGrid({ assets }: { assets: LibraryAsset[] }) {
  if (assets.length === 0) {
    return (
      <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)", padding: "var(--space-md)" }}>
        No assets yet. Build a motion graphic, or add images and memes to your library folder.
      </p>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        overflowY: "auto",
      }}
    >
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} />
      ))}
    </div>
  );
}
