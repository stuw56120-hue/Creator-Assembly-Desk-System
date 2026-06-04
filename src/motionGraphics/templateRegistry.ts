/*
 * C.A.D.S. motion graphic template registry loader.
 *
 * Loads compositions/template-registry.json and exposes lookups + param
 * validation. The renderer (TemplateSelector / Inspector) and the edit-list
 * parser both consume this so there is a single source of truth for which
 * templates exist and what params they accept.
 */

import registryJson from "../../compositions/template-registry.json";
import {
  validateTemplateParams,
  type TemplateDefinition,
  type TemplateRegistry,
} from "../project/editListParser";

// JSON widens enum/type strings to `string`; the registry shape is otherwise
// identical to TemplateRegistry.
const registry = registryJson as unknown as TemplateRegistry;

/** The five built-in templates the C.A.D.S. spec ships. */
export const BUILT_IN_TEMPLATE_IDS = [
  "topic_banner",
  "lower_third",
  "subscribe_flash",
  "quote_card",
  "intro_title",
] as const;

export function getTemplateRegistry(): TemplateRegistry {
  return registry;
}

export function listTemplateIds(): string[] {
  return Object.keys(registry);
}

export function hasTemplate(templateId: string): boolean {
  return templateId in registry;
}

/** @throws if the template id is not registered. */
export function getTemplate(templateId: string): TemplateDefinition {
  const def = registry[templateId];
  if (!def) {
    throw new Error(`Unknown motion graphic template: "${templateId}"`);
  }
  return def;
}

/** Validate (and default-fill) params for a template. @throws on unknown id. */
export function validateParams(
  templateId: string,
  params: Record<string, unknown>,
): { errors: string[]; merged: Record<string, unknown> } {
  return validateTemplateParams(getTemplate(templateId), params);
}
