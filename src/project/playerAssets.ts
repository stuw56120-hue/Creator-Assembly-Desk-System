/*
 * Derives Asset Onboarding upload slots from the customGPT's player image
 * overlays. Each player (image_subject) may need several images — portrait,
 * action, celebration — so we emit one required-asset slot per unique
 * (image_subject × image_type). The onboarding screen groups these by player.
 */

import type { PlayerImageOverlay, RequiredAsset } from "./editListParser";

/** Field names the customGPT might use for the image role. */
const ROLE_KEYS = ["image_type", "shot_type", "role", "type", "variant"];
const DEFAULT_ROLE = "image";

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function playerOverlayRole(overlay: Record<string, unknown>): string {
  for (const key of ROLE_KEYS) {
    const v = overlay[key];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  }
  return DEFAULT_ROLE;
}

/**
 * The canonical onboarding asset id for a (player, role) pair. Shared by the
 * onboarding slot derivation and the timeline builder so an image overlay event
 * and its upload row resolve to the SAME id — that's how an uploaded image is
 * linked back to its on-screen overlay.
 */
export function playerAssetId(subject: string, role: string): string {
  return `asset_${slug(subject)}_${slug(role)}`;
}

/**
 * One RequiredAsset per unique (image_subject, role). Entries with no subject
 * are skipped. used_in collects the referencing overlay ids; a slot is optional
 * only when every overlay feeding it is optional.
 */
export function requiredAssetsFromPlayerOverlays(
  overlays: PlayerImageOverlay[],
): RequiredAsset[] {
  // subject → role → { ids, allOptional }
  const bySubject = new Map<string, Map<string, { ids: string[]; allOptional: boolean }>>();
  // Preserve first-seen order of subjects and roles.
  const order: { subject: string; role: string }[] = [];

  for (const overlay of overlays) {
    const subject = (overlay.image_subject ?? "").trim();
    if (!subject) continue;
    const role = playerOverlayRole(overlay as Record<string, unknown>);

    const roles = bySubject.get(subject) ?? new Map();
    const slot = roles.get(role) ?? { ids: [] as string[], allOptional: true };
    if (typeof overlay.overlay_id === "string") slot.ids.push(overlay.overlay_id);
    slot.allOptional = slot.allOptional && overlay.optional === true;
    if (!roles.has(role)) order.push({ subject, role });
    roles.set(role, slot);
    bySubject.set(subject, roles);
  }

  return order.map(({ subject, role }) => {
    const slot = bySubject.get(subject)!.get(role)!;
    return {
      asset_id: playerAssetId(subject, role),
      purpose: `${capitalize(role)} image of ${subject}`,
      suggested_filename: `${slug(subject)}-${slug(role)}`,
      used_in: slot.ids,
      optional: slot.allOptional && slot.ids.length > 0 ? true : false,
      image_subject: subject,
      image_type: role,
    };
  });
}

/** Merge derived player slots into any explicit required_assets (explicit wins by id). */
export function mergeRequiredAssets(
  explicit: RequiredAsset[],
  derived: RequiredAsset[],
): RequiredAsset[] {
  const seen = new Set(explicit.map((a) => a.asset_id));
  return [...explicit, ...derived.filter((a) => !seen.has(a.asset_id))];
}
