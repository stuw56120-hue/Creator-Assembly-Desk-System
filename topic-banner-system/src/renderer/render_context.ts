import type { BannerStyle } from "../types.js";

export function applyScaleFactor(
  style: BannerStyle,
  scaleFactor: number
): BannerStyle {
  return {
    ...style,
    border_radius: style.border_radius * scaleFactor,
    shadow_blur:
      style.shadow_blur !== undefined
        ? style.shadow_blur * scaleFactor
        : undefined,
  };
}
