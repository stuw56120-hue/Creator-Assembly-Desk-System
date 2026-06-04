import { describe, expect, it } from "vitest";
import { importEditListText } from "./editListImport";
import { testRegistry } from "./__fixtures__/testRegistry";
import sweetRelief from "./__fixtures__/sweet-relief.json";

describe("importEditListText", () => {
  it("imports valid edit-list JSON text (paste/file path)", () => {
    const result = importEditListText(JSON.stringify(sweetRelief), testRegistry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.editList.project_name).toBe("Sweet Relief");
    expect(result.buildQueue).toHaveLength(2);
  });

  it("returns a clean error for malformed JSON instead of throwing", () => {
    const result = importEditListText("{ not valid json", testRegistry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/Invalid JSON/);
  });

  it("surfaces schema errors for well-formed-but-wrong JSON", () => {
    const result = importEditListText(JSON.stringify({ longform: {} }), testRegistry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
