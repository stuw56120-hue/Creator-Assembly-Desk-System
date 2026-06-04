/*
 * Tests for the eligibility table. The spec enumerates 11 eligible templates
 * (quote_card, punch_in, subscribe_flash, plus eight topic_change_banner_*
 * variants) and 2 explicitly-ineligible ones. Anything else is hidden.
 */

import { describe, expect, it } from "vitest";
import {
  ELIGIBLE_BG_TEMPLATES,
  INELIGIBLE_BG_TEMPLATES,
  isBackgroundEligible,
} from "./backgroundEligibility";

const ELIGIBLE = [
  "quote_card",
  "punch_in",
  "subscribe_flash",
  "topic_change_banner_clean",
  "topic_change_banner_bold",
  "topic_change_banner_sports",
  "topic_change_banner_glass",
  "topic_change_banner_comedy",
  "topic_change_banner_dark",
  "topic_change_banner_neon",
  "topic_change_banner_split",
];

const INELIGIBLE = ["meme_pop_in", "side_panel_image"];

describe("isBackgroundEligible", () => {
  it.each(ELIGIBLE)("treats %s as eligible", (id) => {
    expect(isBackgroundEligible(id)).toBe(true);
  });

  it.each(INELIGIBLE)("treats %s as ineligible", (id) => {
    expect(isBackgroundEligible(id)).toBe(false);
  });

  it("treats every other template id as ineligible (default-hide)", () => {
    expect(isBackgroundEligible("topic_banner")).toBe(false);
    expect(isBackgroundEligible("lower_third")).toBe(false);
    expect(isBackgroundEligible("intro_title")).toBe(false);
    expect(isBackgroundEligible("unknown_template")).toBe(false);
  });

  it("treats nullish ids as ineligible (defensive)", () => {
    expect(isBackgroundEligible(undefined)).toBe(false);
    expect(isBackgroundEligible(null)).toBe(false);
    expect(isBackgroundEligible("")).toBe(false);
  });
});

it("eligibility and ineligibility sets do not overlap", () => {
  for (const id of ELIGIBLE_BG_TEMPLATES) {
    expect(INELIGIBLE_BG_TEMPLATES.has(id)).toBe(false);
  }
});
