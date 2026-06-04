/*
 * Right-hand Inspector. Shows the selected timeline event: a common header
 * (kind, enable toggle, lock, resolve-review, delete) plus a kind-specific
 * editor. Delete is refused for cuts (toggled, never deleted) and locked clips.
 */

import { CutInspector } from "./CutInspector";
import { OverlayInspector } from "./OverlayInspector";
import { MotionGraphicInspector } from "./MotionGraphicInspector";
import { ChapterInspector } from "./ChapterInspector";
import { ShortInspector } from "./ShortInspector";
import { CaptionInspector } from "./CaptionInspector";
import { useProjectStore } from "../project/projectStore";
import type { TimelineEvent } from "../project/types";

function Variant({ event }: { event: TimelineEvent }) {
  switch (event.kind) {
    case "cut":
      return <CutInspector event={event} />;
    case "caption":
      return <CaptionInspector event={event} />;
    case "motion_graphic":
      return <MotionGraphicInspector event={event} />;
    case "image":
    case "meme":
      return <OverlayInspector event={event} />;
    case "chapter":
      return <ChapterInspector event={event} />;
    case "short_in":
    case "short_out":
      return <ShortInspector event={event} />;
    default:
      return null;
  }
}

export function InspectorPanel() {
  const event = useProjectStore((s) => s.events.find((e) => e.id === s.selectedEventId) ?? null);

  const wrap: React.CSSProperties = {
    width: 320,
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    height: "100%",
    overflowY: "auto",
    padding: "var(--space-md)",
    boxSizing: "border-box",
  };

  if (!event) {
    return (
      <aside style={wrap}>
        <p style={{ color: "var(--text-tertiary)", fontSize: "var(--font-size-caption)" }}>
          Select a clip on the timeline to inspect it.
        </p>
      </aside>
    );
  }

  const canDelete = event.kind !== "cut" && !event.locked;

  return (
    <aside style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-md)" }}>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--text-tertiary)",
          }}
        >
          {event.kind.replace("_", " ")}
        </span>
        {event.locked && <span title="Locked">🔒</span>}
        <label style={{ marginLeft: "auto", fontSize: "var(--font-size-caption)", display: "flex", gap: 4 }}>
          <input
            type="checkbox"
            checked={event.enabled}
            onChange={() => useProjectStore.getState().toggleEvent(event.id)}
          />
          Enabled
        </label>
      </div>

      <h3 style={{ marginBottom: "var(--space-md)", wordBreak: "break-word" }}>{event.label}</h3>

      {event.reviewRequired && (
        <button
          type="button"
          onClick={() => useProjectStore.getState().resolveReview(event.id)}
          className="btn-primary"
          style={{ marginBottom: "var(--space-md)" }}
        >
          ⚠ Resolve review
        </button>
      )}

      <Variant key={event.id} event={event} />

      {canDelete && (
        <button
          type="button"
          onClick={() => {
            useProjectStore.getState().removeEvent(event.id);
            useProjectStore.getState().setSelectedEvent(null);
          }}
          style={{
            marginTop: "var(--space-lg)",
            background: "transparent",
            border: "1px solid var(--border)",
            color: "#ff6b6b",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-xs) var(--space-md)",
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      )}
    </aside>
  );
}
