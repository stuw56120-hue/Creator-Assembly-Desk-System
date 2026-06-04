/*
 * Param form for the Motion Graphics Studio / Inspector. Renders one labelled
 * control per template param: text, colour picker, enum dropdown, number
 * slider, or boolean checkbox. Shared by the Studio (Step 9) and the Motion
 * Graphic Inspector (Step 15).
 */

import { getTemplate } from "../motionGraphics/templateRegistry";
import type { TemplateParamSchema } from "../project/editListParser";

interface ParamFormProps {
  templateId: string;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--text-secondary)",
  textTransform: "capitalize",
};

const inputStyle: React.CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text)",
  padding: "var(--space-xs) var(--space-sm)",
  font: "inherit",
};

function Field({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: TemplateParamSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = name.replace(/_/g, " ");

  let control: React.ReactNode;
  switch (schema.type) {
    case "color":
      control = (
        <input
          type="color"
          value={typeof value === "string" && value ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, padding: 2, height: 32, width: 64 }}
        />
      );
      break;
    case "enum":
      control = (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {(schema.values ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
      break;
    case "number":
      control = (
        <input
          type="number"
          step="0.1"
          value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          style={inputStyle}
        />
      );
      break;
    case "boolean":
      control = (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      );
      break;
    default:
      control = (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
  }

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <span style={labelStyle}>
        {label}
        {schema.required ? " *" : ""}
      </span>
      {control}
    </label>
  );
}

export function ParamForm({ templateId, params, onChange }: ParamFormProps) {
  const def = getTemplate(templateId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {Object.entries(def.params).map(([name, schema]) => (
        <Field
          key={name}
          name={name}
          schema={schema}
          value={params[name]}
          onChange={(value) => onChange({ ...params, [name]: value })}
        />
      ))}
    </div>
  );
}
