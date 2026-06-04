/*
 * Helpers for seeding and rendering motion graphic params in the Studio UI.
 */

import { getTemplate } from "../motionGraphics/templateRegistry";

/** Seed a params object for a template from its declared defaults. */
export function initParams(templateId: string): Record<string, unknown> {
  const def = getTemplate(templateId);
  const params: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(def.params)) {
    if (schema.default !== undefined) {
      params[key] = schema.default;
    } else if (schema.type === "number") {
      params[key] = 0;
    } else if (schema.type === "boolean") {
      params[key] = false;
    } else if (schema.type === "enum") {
      params[key] = schema.values?.[0] ?? "";
    } else {
      params[key] = "";
    }
  }
  return params;
}
