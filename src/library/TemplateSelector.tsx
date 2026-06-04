/*
 * Template picker for the Motion Graphics Studio. Lists the registered
 * templates; selecting one drives the param form.
 */

import { getTemplateRegistry } from "../motionGraphics/templateRegistry";

interface TemplateSelectorProps {
  selectedId: string;
  onSelect: (templateId: string) => void;
}

export function TemplateSelector({ selectedId, onSelect }: TemplateSelectorProps) {
  const registry = getTemplateRegistry();
  const entries = Object.entries(registry);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      {entries.map(([id, def]) => {
        const selected = id === selectedId;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            style={{
              textAlign: "left",
              padding: "var(--space-sm) var(--space-md)",
              borderRadius: "var(--radius-md)",
              border: `1px solid ${selected ? "var(--accent-blue)" : "var(--border)"}`,
              background: selected ? "var(--accent-blue-light)" : "var(--surface)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600 }}>{def.label}</div>
            <div style={{ fontSize: "var(--font-size-caption)", color: "var(--text-tertiary)" }}>
              {id} · {def.defaultDuration}s
            </div>
          </button>
        );
      })}
    </div>
  );
}
