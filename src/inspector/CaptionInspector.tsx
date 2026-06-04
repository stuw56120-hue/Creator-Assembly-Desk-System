import { ReadOnly, TextField } from "./fields";
import { useProjectStore } from "../project/projectStore";
import { countWords, EXCESS_WORDS } from "../project/captions";
import type { TimelineEvent } from "../project/types";

export function CaptionInspector({ event }: { event: TimelineEvent }) {
  const caption = event.captionData;
  if (!caption) return null;
  const update = useProjectStore.getState().updateEvent;
  const words = countWords(caption.text);
  const tooLong = words > EXCESS_WORDS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <TextField
        label="Speaker"
        value={caption.speaker}
        onChange={(v) => update(event.id, { captionData: { speaker: v } })}
      />
      <TextField
        label="Caption text"
        value={caption.text}
        onChange={(v) => update(event.id, { label: v, captionData: { text: v } })}
      />
      <ReadOnly
        label="Words"
        value={
          <span style={{ color: tooLong ? "#ff6b6b" : "var(--text)" }}>
            {words}
            {tooLong ? ` (over ${EXCESS_WORDS})` : ""}
          </span>
        }
      />
      <p style={{ fontSize: "var(--font-size-caption)", color: "var(--text-tertiary)" }}>
        Use the Caption Editor (toolbar) to split, merge, or upload a corrected transcript.
      </p>
    </div>
  );
}
