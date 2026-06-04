import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TEMPLATE_IDS,
  getTemplate,
  getTemplateRegistry,
  hasTemplate,
  listTemplateIds,
  validateParams,
} from "./templateRegistry";
import { parseEditList } from "../project/editListParser";
import sweetRelief from "../project/__fixtures__/sweet-relief.json";

describe("template registry", () => {
  it("loads all five built-in templates", () => {
    for (const id of BUILT_IN_TEMPLATE_IDS) {
      expect(hasTemplate(id)).toBe(true);
      const def = getTemplate(id);
      expect(def.compositionPath).toContain("composition.html");
      expect(typeof def.defaultDuration).toBe("number");
      expect(Object.keys(def.params).length).toBeGreaterThan(0);
    }
    expect(listTemplateIds().length).toBeGreaterThanOrEqual(BUILT_IN_TEMPLATE_IDS.length);
  });

  it("throws on an unknown template id", () => {
    expect(() => getTemplate("does_not_exist")).toThrow(/Unknown motion graphic template/);
  });

  it("rejects params that omit a required field", () => {
    const { errors } = validateParams("quote_card", {}); // quote_card requires `text`
    expect(errors.some((e) => e.includes('missing required param "text"'))).toBe(true);
  });

  it("accepts valid params and fills declared defaults", () => {
    const { errors, merged } = validateParams("quote_card", { text: "Hello" });
    expect(errors).toEqual([]);
    expect(merged.accent_colour).toBe("#00c2ff"); // default applied
    expect(merged.duration).toBe(4);
  });

  it("rejects an enum value outside the allowed set", () => {
    const { errors } = validateParams("topic_banner", { title: "x", animation_in: "explode" });
    expect(errors.some((e) => e.includes('param "animation_in"'))).toBe(true);
  });

  it("validates the real Sweet Relief fixture against the shipped registry", () => {
    const result = parseEditList(sweetRelief, getTemplateRegistry());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.buildQueue).toHaveLength(2);
  });

  it("registers meme_pop_in and side_panel_image (lenient params pass validation)", () => {
    for (const id of ["meme_pop_in", "side_panel_image"]) {
      expect(hasTemplate(id)).toBe(true);
      const def = getTemplate(id);
      expect(def.compositionPath).toContain("composition.html");
      // No required params → an overlay referencing them validates even with no params.
      expect(validateParams(id, {}).errors).toEqual([]);
    }
    // A representative overlay (text + placement + duration) validates too.
    expect(validateParams("meme_pop_in", { text: "lol", placement: "center", duration: 1.5 }).errors).toEqual([]);
    expect(validateParams("side_panel_image", { image: "/lib/x.png", caption: "Kane" }).errors).toEqual([]);
  });
});
