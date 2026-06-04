/*
 * Left sidebar — the Asset Library. Tabs (Images / Memes / Motion Graphics),
 * a filename search, a drag-source grid, and a "+" to open the Motion Graphics
 * Studio for creating a new graphic.
 */

import { useState } from "react";
import { AssetCard } from "./AssetCard";
import { AssetGrid } from "./AssetGrid";
import { useAssetLibrary, refreshAssetLibrary } from "./useAssetLibrary";
import { useAssetStore, contextualAddAction, type CategoryFilter } from "./assetStore";

const TABS: { key: CategoryFilter; label: string }[] = [
  { key: "image", label: "Images" },
  { key: "meme", label: "Memes" },
  { key: "motion_graphic", label: "Motion" },
];

export function AssetLibrary({ onCreateNew }: { onCreateNew: () => void }) {
  useAssetLibrary();
  const query = useAssetStore((s) => s.query);
  const category = useAssetStore((s) => s.category);
  const setQuery = useAssetStore((s) => s.setQuery);
  const setCategory = useAssetStore((s) => s.setCategory);
  const visible = useAssetStore((s) => s.visibleAssets());
  const groups = useAssetStore((s) => s.groups);

  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);

  async function handleClean() {
    setCleaning(true);
    setCleanMsg(null);
    try {
      const res = await window.cads?.assets?.clean();
      await refreshAssetLibrary(); // pull the cleaned index back into the sidebar
      if (!res || res.removed === 0) {
        setCleanMsg("Library is clean — no broken entries found.");
      } else {
        setCleanMsg(`Removed ${res.removed} broken ${res.removed === 1 ? "entry" : "entries"}.`);
      }
    } catch {
      setCleanMsg("Couldn’t clean the library. Please try again.");
    } finally {
      setCleaning(false);
    }
  }

  // Bug 7: the "+" button is contextual to the open sub-panel.
  const addAction = contextualAddAction(category);
  async function handleAdd() {
    if (addAction.kind === "motion_graphic") {
      onCreateNew(); // open the Motion Graphics Studio
      return;
    }
    // image / meme → import a file into the library, then refresh the grid.
    const filePath = await window.cads?.dialog?.pickFile({
      title: addAction.label,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "heic"] }],
    });
    if (!filePath) return;
    const base = (filePath.split(/[\\/]/).pop() ?? "image").replace(/\.[^.]+$/, "");
    const slug =
      base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || addAction.kind;
    try {
      await window.cads.image.upload({
        filePath,
        assetId: `${addAction.kind}_${slug}`,
        suggestedFilename: slug,
      });
      await refreshAssetLibrary();
    } catch {
      /* the upload handler surfaces its own error; keep the sidebar responsive */
    }
  }

  // On the Images tab, show processed images grouped into original/nobg/bokeh
  // triads when the index has asset groups.
  const showGrouped = category === "image" && groups.length > 0 && !query.trim();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--border)",
        background: "var(--surface)",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", gap: 4, padding: "var(--space-sm)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setCategory(tab.key)}
            style={{
              flex: 1,
              fontSize: 11,
              padding: "4px 0",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: category === tab.key ? "var(--accent-blue-light)" : "transparent",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          onClick={handleAdd}
          title={addAction.label}
          style={{
            width: 28,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--accent-blue-border)",
            background: "var(--accent-blue-light)",
            color: "var(--accent-blue)",
            cursor: "pointer",
          }}
        >
          +
        </button>
      </div>
      <input
        type="search"
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          margin: "0 var(--space-sm) var(--space-sm)",
          padding: "var(--space-xs) var(--space-sm)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)",
          background: "var(--surface2)",
          color: "var(--text)",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          padding: "0 var(--space-sm) var(--space-sm)",
        }}
      >
        <button
          type="button"
          onClick={handleClean}
          disabled={cleaning}
          title="Remove library entries whose image or graphic file is no longer on disk"
          style={{
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            cursor: cleaning ? "default" : "pointer",
            opacity: cleaning ? 0.6 : 1,
          }}
        >
          {cleaning ? "Cleaning…" : "Clean library"}
        </button>
        {cleanMsg && (
          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{cleanMsg}</span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {showGrouped ? <GroupedImages /> : <AssetGrid assets={visible} />}
      </div>
    </div>
  );
}

/** Grouped Images tab: one labelled triad per processed image. */
function GroupedImages() {
  const groups = useAssetStore((s) => s.groups);
  const assetById = useAssetStore((s) => s.assetById);

  return (
    <div style={{ padding: "var(--space-sm)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {groups.map((group) => {
        const variants = [group.variants.original, group.variants.nobg, group.variants.bgBlur]
          .map((id) => assetById(id))
          .filter((a): a is NonNullable<typeof a> => Boolean(a));
        if (variants.length === 0) return null;
        return (
          <div key={group.assetGroupId}>
            <div style={{ fontSize: "var(--font-size-caption)", fontWeight: 600, marginBottom: 4 }}>
              {group.suggestedFilename}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-sm)" }}>
              {variants.map((asset) => (
                <AssetCard key={asset.id} asset={asset} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
