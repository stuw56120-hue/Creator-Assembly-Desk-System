/*
 * A draggable asset tile. Dragging onto the timeline drops a new overlay
 * (see TimelineWorkArea). Motion graphics show a looping WebM thumbnail frame.
 */

import { ASSET_DND_MIME } from "../timeline/TimelineWorkArea";
import { assetUrl } from "./MotionGraphicPreview";
import { useProjectStore } from "../project/projectStore";
import { assetHasBackground, type LibraryAsset } from "./assetStore";

/**
 * A library motion graphic corresponds to a timeline event with the SAME id
 * (assetId === mgId === event.id). Selecting that event opens the MG inspector
 * on the right showing the graphic's current params. Harmless for assets with
 * no matching event (images/memes not placed on the timeline) — selection is
 * simply left unchanged.
 */
function openInspectorFor(asset: LibraryAsset): void {
  const store = useProjectStore.getState();
  if (store.events.some((e) => e.id === asset.id)) store.setSelectedEvent(asset.id);
}

export function AssetCard({ asset }: { asset: LibraryAsset }) {
  const thumb = asset.thumbnailPath ?? (asset.category === "motion_graphic" ? null : asset.absolutePath);
  const hasBackground = assetHasBackground(asset);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DND_MIME, JSON.stringify(asset));
        e.dataTransfer.effectAllowed = "copy";
      }}
      // Click / double-click / right-click all open the inspector for this graphic.
      onClick={() => openInspectorFor(asset)}
      onContextMenu={(e) => {
        e.preventDefault();
        openInspectorFor(asset);
      }}
      title={asset.filename}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        background: "var(--surface2)",
        cursor: "pointer",
        position: "relative",
      }}
    >
      {hasBackground && (
        <span
          // Fix 3: at-a-glance indicator that this MG has a background image set.
          title="Has a background image"
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            zIndex: 1,
            fontSize: 10,
            lineHeight: "14px",
            width: 16,
            height: 16,
            textAlign: "center",
            borderRadius: 4,
            background: "rgba(0,0,0,0.65)",
          }}
        >
          🖼
        </span>
      )}
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "repeating-conic-gradient(var(--surface) 0% 25%, var(--surface2) 0% 50%) 50% / 12px 12px",
        }}
      >
        {thumb ? (
          <img
            src={assetUrl(thumb)}
            alt={asset.filename}
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        ) : (
          <span style={{ fontSize: 22 }}>🎬</span>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          padding: "3px 6px",
          color: "var(--text-secondary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {asset.filename}
      </div>
    </div>
  );
}
