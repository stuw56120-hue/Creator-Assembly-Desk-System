import { ReadOnly, TextField } from "./fields";
import { useProjectStore } from "../project/projectStore";
import type { TimelineEvent } from "../project/types";

export function ChapterInspector({ event }: { event: TimelineEvent }) {
  const update = useProjectStore.getState().updateEvent;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <TextField
        label="Chapter title"
        value={event.label}
        onChange={(v) => update(event.id, { label: v })}
      />
      <ReadOnly label="Source" value={event.chapterData?.detectionSource ?? "—"} />
      {event.reviewRequired && (
        <p style={{ fontSize: "var(--font-size-caption)", color: "var(--accent-purple)" }}>
          ⚠ Replace the placeholder title, then resolve (header) to clear the warning.
        </p>
      )}
    </div>
  );
}
