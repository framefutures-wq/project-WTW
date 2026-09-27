export const CARD_IMAGE_RATIO = 3 / 4;
export type ImageFit = "cover" | "contain";

/**
 * Home cards use a portrait editorial frame.
 * Preserve portrait/square poster artwork in full; crop ordinary landscape
 * photography into the same frame so the grid keeps one consistent rhythm.
 */
export function cardImageFit(
  width: number,
  height: number,
  containerRatio = CARD_IMAGE_RATIO,
): ImageFit {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(containerRatio) ||
    width <= 0 ||
    height <= 0 ||
    containerRatio <= 0
  )
    return "cover";

  const sourceRatio = width / height;
  return sourceRatio <= 1.05 ? "contain" : "cover";
}