/*
 * Step 2 — customGPT edit-list import. Wraps parseEditList with a JSON.parse
 * guard so both the file-import and paste-text paths share one entry point and
 * surface a clean error for malformed JSON.
 */

import { parseEditList, type ParseEditListResult, type TemplateRegistry } from "./editListParser";

/**
 * Parse raw edit-list text (from a chosen file or the paste box) and validate
 * it against the template registry. Malformed JSON returns a clean error
 * instead of throwing.
 */
export function importEditListText(text: string, registry: TemplateRegistry): ParseEditListResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      errors: [`Invalid JSON: ${(err as Error).message}`],
      warnings: [],
    };
  }
  return parseEditList(json, registry);
}
