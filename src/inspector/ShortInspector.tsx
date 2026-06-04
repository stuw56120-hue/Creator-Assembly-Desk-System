import { NumberField, ReadOnly, TextField } from "./fields";
import { useProjectStore } from "../project/projectStore";
import type { TimelineEvent } from "../project/types";

export function ShortInspector({ event }: { event: TimelineEvent }) {
  const short = event.shortData;
  if (!short) return null;
  const update = useProjectStore.getState().updateEvent;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <TextField
        label="Hook"
        value={short.hook}
        onChange={(v) => update(event.id, { shortData: { hook: v }, label: v })}
      />
      <NumberField label="In (s)" value={event.start} onChange={(v) => update(event.id, { start: v })} />
      <NumberField
        label="Duration (s)"
        value={event.duration}
        onChange={(v) => update(event.id, { duration: v })}
      />
      <ReadOnly label="Aspect" value={short.aspectRatio} />
      <ReadOnly label="Captions" value={short.captionStyle} />
      {short.notes.length > 0 && (
        <div>
          <span style={{ fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>
            Notes
          </span>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: "var(--font-size-caption)" }}>
            {short.notes.map((n, i) => (
              <li key={i} style={{ color: "var(--text-tertiary)" }}>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
      {event.reviewRequired && (
        <p style={{ fontSize: "var(--font-size-caption)", color: "var(--accent-purple)" }}>
          ⚠ Write the real spoken hook, then resolve (header).
        </p>
      )}
    </div>
  );
}
