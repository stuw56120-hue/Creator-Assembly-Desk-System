/*
 * Which motion-graphic templates support a per-MG background image.
 *
 * The spec lists 11 eligible IDs (quote_card, punch_in, subscribe_flash, plus
 * eight topic_change_banner_* variants) and two explicit ineligible IDs
 * (meme_pop_in, side_panel_image — their compositions already embed an image
 * of their own and a backdrop would clash). Anything else is hidden by default.
 *
 * Used in TWO places: the inspector (hide / show the four controls) AND the
 * MG build path (strip background_* params from ineligible templates even if
 * a stale project somehow still carries them).
 */

export const ELIGIBLE_BG_TEMPLATES: ReadonlySet<string> = new Set([
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
]);

export const INELIGIBLE_BG_TEMPLATES: ReadonlySet<string> = new Set([
  "meme_pop_in",
  "side_panel_image",
]);

export function isBackgroundEligible(templateId: string | undefined | null): boolean {
  if (!templateId) return false;
  return ELIGIBLE_BG_TEMPLATES.has(templateId);
}
