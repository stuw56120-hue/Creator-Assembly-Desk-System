import { ReadOnly } from "./fields";
import type { TimelineEvent } from "../project/types";

export function CutInspector({ event }: { event: TimelineEvent }) {
  const cut = event.cutData;
  if (!cut) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <ReadOnly label="Removes" value={`${cut.removeSeconds.toFixed(1)}s`} />
      <ReadOnly label="Silence" value={`${cut.silenceDurationSeconds.toFixed(1)}s`} />
      <ReadOnly label="Confidence" value={`${Math.round(event.confidence * 100)}%`} />
      {cut.preserveIf.length > 0 && (
        <ReadOnly label="Preserve if" value={cut.preserveIf.join(", ")} />
      )}
      <p style={{ fontSize: "var(--font-size-caption)", color: "var(--text-tertiary)" }}>
        Toggle this cut off (header switch) to keep the moment in the video.
      </p>
    </div>
  );
}
