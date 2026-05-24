import type { BannerPosition, BoundingBox } from "../types.js";

const MAX_WIDTH_REDUCTION = 0.3;

function overlaps(banner: BannerPosition, zone: BoundingBox): boolean {
  return !(
    banner.x + banner.width <= zone.x ||
    banner.x >= zone.x + zone.width ||
    banner.y + banner.height <= zone.y ||
    banner.y >= zone.y + zone.height
  );
}

function shiftVertically(
  banner: BannerPosition,
  zone: BoundingBox
): BannerPosition | null {
  const upDelta = banner.y + banner.height - zone.y;
  const downDelta = zone.y + zone.height - banner.y;

  if (upDelta <= downDelta) {
    const newY = zone.y - banner.height;
    if (newY >= 0) {
      return { ...banner, y: newY };
    }
  }

  const newY = zone.y + zone.height;
  if (newY + banner.height <= 1) {
    return { ...banner, y: newY };
  }

  return null;
}

function reduceWidth(
  banner: BannerPosition,
  zone: BoundingBox
): BannerPosition | null {
  const originalWidth = banner.width;
  const minWidth = originalWidth * (1 - MAX_WIDTH_REDUCTION);

  for (let w = originalWidth; w >= minWidth; w -= originalWidth * 0.05) {
    const candidate = { ...banner, width: w };
    if (!overlaps(candidate, zone)) {
      return candidate;
    }
  }
  return null;
}

export function resolvePosition(
  proposed: BannerPosition,
  faceZones: BoundingBox[],
  _bannerHeight: number
): { position: BannerPosition; suppressed: boolean; reason?: string } {
  let current = { ...proposed };

  for (const zone of faceZones) {
    if (!overlaps(current, zone)) continue;

    const shifted = shiftVertically(current, zone);
    if (shifted && !faceZones.some((z) => overlaps(shifted, z))) {
      current = shifted;
      continue;
    }

    const narrowed = reduceWidth(current, zone);
    if (narrowed && !faceZones.some((z) => overlaps(narrowed, z))) {
      current = narrowed;
      continue;
    }

    return { position: proposed, suppressed: true, reason: "face_zone_unresolvable" };
  }

  return { position: current, suppressed: false };
}
