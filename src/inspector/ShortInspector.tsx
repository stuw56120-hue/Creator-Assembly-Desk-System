/*
 * Shorts inspector (Shorts Schema v2). Shows the short's ordered SEGMENT LIST —
 * each segment's source timecode range, duration, energy badge, transition
 * labels and an expandable overlay list — and lets the user add / remove
 * segments. A legacy v1 clip short (no segments) falls back to the old in/
 * duration fields with a deprecation note.
 */

import { useState } from "react";
import { NumberField, ReadOnly, SelectField, TextField } from "./fields";
import { useProjectStore } from "../project/projectStore";
import { useShortsQueueStore } from "../toolbar/shortsQueueStore";
import type { ShortSegmentSummary, TimelineEvent } from "../project/types";

const ENERGY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "peak", label: "Peak" },
];
const ENERGY_COLOUR: Record<string, string> = {
  low: "#6b7280",
  medium: "#3b82f6",
  high: "#f59e0b",
  peak: "#ef4444",
};
const TRANSITION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "cut", label: "Cut" },
  { value: "smash_cut", label: "Smash cut" },
  { value: "punch_zoom", label: "Punch zoom" },
  { value: "whip_pan", label: "Whip pan" },
  { value: "flash_white", label: "Flash white" },
];

/** mm:ss.cs for a source-seconds value. */
function fmt(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.max(0, s) % 60;
  return `${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

export function ShortInspector({ event }: { event: TimelineEvent }) {
  const short = event.shortData;
  if (!short) return null;
  const update = useProjectStore.getState().updateEvent;
  const segments = short.segments ?? [];

  // Persist a new segment list and keep the timeline marker in sync (start = the
  // first segment's source start; duration = the assembled length).
  function commitSegments(next: ShortSegmentSummary[]) {
    const assembled = next.reduce((acc, s) => acc + Math.max(0, s.outSeconds - s.inSeconds), 0);
    update(event.id, {
      shortData: { segments: next },
      start: next.length > 0 ? next[0].inSeconds : event.start,
      duration: next.length > 0 ? Number(assembled.toFixed(3)) : event.duration,
    });
  }
  const updateSegment = (i: number, patch: Partial<ShortSegmentSummary>) =>
    commitSegments(segments.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const removeSegment = (i: number) => commitSegments(segments.filter((_, k) => k !== i));
  function addSegment() {
    const lastOut = segments.length > 0 ? segments[segments.length - 1].outSeconds : event.start;
    commitSegments([
      ...segments,
      {
        segmentId: `seg_${String(segments.length + 1).padStart(3, "0")}`,
        inSeconds: Number(lastOut.toFixed(3)),
        outSeconds: Number((lastOut + 5).toFixed(3)),
        energy: "medium",
        transitionIn: segments.length === 0 ? "none" : "cut",
        transitionOut: "cut",
        overlays: [],
        captionEmphasis: [],
      },
    ]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      <TextField
        label="Hook"
        value={short.hook}
        onChange={(v) => update(event.id, { shortData: { hook: v }, label: v })}
      />
      <ReadOnly label="Aspect" value={short.aspectRatio} />
      <ReadOnly label="Captions" value={short.captionStyle} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 4,
        }}
      >
        <span style={{ fontSize: "var(--font-size-caption)", fontWeight: 600 }}>
          Segments ({segments.length})
        </span>
        <button type="button" onClick={addSegment} style={addBtn}>
          + Add segment
        </button>
      </div>

      {segments.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-sm)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
          }}
        >
          <p style={{ margin: 0, fontSize: "var(--font-size-caption)", color: "var(--accent-purple, #b794f6)" }}>
            Legacy v1 clip — no segments. Re-generate with the Short Form Director v2 to use segments.
          </p>
          <NumberField label="In (s)" value={event.start} onChange={(v) => update(event.id, { start: v })} />
          <NumberField
            label="Duration (s)"
            value={event.duration}
            onChange={(v) => update(event.id, { duration: v })}
          />
        </div>
      ) : (
        segments.map((seg, i) => (
          <SegmentRow
            key={i}
            index={i}
            seg={seg}
            onChange={(patch) => updateSegment(i, patch)}
            onRemove={() => removeSegment(i)}
          />
        ))
      )}

      {segments.length > 0 && (
        <button
          type="button"
          onClick={() => useShortsQueueStore.getState().openQueue(event.id, true)}
          style={renderPreviewBtn}
          title="Render a 720p preview, then approve for full quality"
        >
          ▶ Render Preview
        </button>
      )}

      {short.notes.length > 0 && (
        <div>
          <span style={{ fontSize: "var(--font-size-caption)", color: "var(--text-secondary)" }}>Notes</span>
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

function SegmentRow({
  index,
  seg,
  onChange,
  onRemove,
}: {
  index: number;
  seg: ShortSegmentSummary;
  onChange: (patch: Partial<ShortSegmentSummary>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dur = Math.max(0, seg.outSeconds - seg.inSeconds);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
        background: "var(--surface2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          S{index + 1}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.3,
            padding: "1px 6px",
            borderRadius: 4,
            color: "#0a0a0a",
            background: ENERGY_COLOUR[seg.energy] ?? "#6b7280",
          }}
        >
          {seg.energy}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-secondary)",
          }}
        >
          {fmt(seg.inSeconds)}–{fmt(seg.outSeconds)} · {dur.toFixed(1)}s
        </span>
        <button type="button" onClick={onRemove} title="Remove segment" style={removeBtn}>
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <NumberField label="In (s)" value={seg.inSeconds} onChange={(v) => onChange({ inSeconds: v })} />
        </div>
        <div style={{ flex: 1 }}>
          <NumberField label="Out (s)" value={seg.outSeconds} onChange={(v) => onChange({ outSeconds: v })} />
        </div>
      </div>

      <SelectField label="Energy" value={seg.energy} options={ENERGY_OPTIONS} onChange={(v) => onChange({ energy: v })} />

      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <SelectField
            label="In"
            value={seg.transitionIn}
            options={TRANSITION_OPTIONS}
            onChange={(v) => onChange({ transitionIn: v })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <SelectField
            label="Out"
            value={seg.transitionOut}
            options={TRANSITION_OPTIONS}
            onChange={(v) => onChange({ transitionOut: v })}
          />
        </div>
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} style={overlayToggle}>
        {open ? "▾" : "▸"} Overlays ({seg.overlays.length})
      </button>
      {open &&
        (seg.overlays.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11, color: "var(--text-tertiary)" }}>No overlays on this segment.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {seg.overlays.map((ov, k) => (
              <li key={k} style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                {ov.motionGraphicId}
                {ov.text ? ` — “${ov.text}”` : ""} · @{ov.appearAtSeconds}s for {ov.durationSeconds}s
              </li>
            ))}
          </ul>
        ))}

      {seg.captionEmphasis.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
          emphasis: {seg.captionEmphasis.join(", ")}
        </div>
      )}
    </div>
  );
}

const renderPreviewBtn: React.CSSProperties = {
  marginTop: "var(--space-sm)",
  width: "100%",
  fontSize: 13,
  fontWeight: 600,
  padding: "0.5rem 1rem",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--accent-green, #34d399)",
  color: "#0a0a0a",
  cursor: "pointer",
};
const addBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--accent-blue-border, var(--border))",
  background: "var(--accent-blue-light, var(--surface2))",
  color: "var(--accent-blue, var(--text))",
  cursor: "pointer",
};
const removeBtn: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1,
  width: 20,
  height: 20,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "#ff6b6b",
  cursor: "pointer",
};
const overlayToggle: React.CSSProperties = {
  alignSelf: "flex-start",
  fontSize: 11,
  padding: "2px 4px",
  border: "none",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
