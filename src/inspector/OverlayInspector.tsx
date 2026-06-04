import { NumberField, RangeField, SelectField, TextField } from "./fields";
import { useProjectStore } from "../project/projectStore";
import type { TimelineEvent } from "../project/types";

const ENTRY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide_in_left", label: "Slide in (left)" },
  { value: "slide_in_right", label: "Slide in (right)" },
  { value: "pop_in", label: "Pop in" },
];
const EXIT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide_out_left", label: "Slide out (left)" },
  { value: "slide_out_right", label: "Slide out (right)" },
];

export function OverlayInspector({ event }: { event: TimelineEvent }) {
  const ov = event.overlayData;
  if (!ov) return null;
  const update = useProjectStore.getState().updateEvent;
  const isImage = event.kind === "image";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <NumberField label="Start (s)" value={event.start} onChange={(v) => update(event.id, { start: v })} />
      <NumberField
        label="Duration (s)"
        value={event.duration}
        onChange={(v) => update(event.id, { duration: v })}
      />
      <TextField
        label="Placement"
        value={ov.placement}
        onChange={(v) => update(event.id, { overlayData: { placement: v } })}
      />
      <RangeField label="X" value={ov.x} onChange={(v) => update(event.id, { overlayData: { x: v } })} />
      <RangeField label="Y" value={ov.y} onChange={(v) => update(event.id, { overlayData: { y: v } })} />
      <RangeField
        label="Width"
        value={ov.width}
        onChange={(v) => update(event.id, { overlayData: { width: v } })}
      />
      <RangeField
        label="Opacity"
        value={ov.opacity}
        onChange={(v) => update(event.id, { overlayData: { opacity: v } })}
      />

      {isImage && (
        <>
          <SelectField
            label="Entry"
            value={ov.entry ?? "fade"}
            options={ENTRY_OPTIONS}
            onChange={(v) => update(event.id, { overlayData: { entry: v } })}
          />
          <NumberField
            label="Fade in (s)"
            value={ov.fadeInSeconds ?? 0.5}
            onChange={(v) => update(event.id, { overlayData: { fadeInSeconds: v } })}
          />
          <SelectField
            label="Exit"
            value={ov.exit ?? "fade"}
            options={EXIT_OPTIONS}
            onChange={(v) => update(event.id, { overlayData: { exit: v } })}
          />
          <NumberField
            label="Fade out (s)"
            value={ov.fadeOutSeconds ?? 0.5}
            onChange={(v) => update(event.id, { overlayData: { fadeOutSeconds: v } })}
          />
        </>
      )}
    </div>
  );
}
