export const CARD_IMAGE_RATIO = 16 / 10;
export type ImageFit = "cover" | "contain";

/** Keep cover for ordinary photos; preserve posters and panoramas once cover would hide over 35%. */
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
  const visibleFraction = Math.min(
    sourceRatio / containerRatio,
    containerRatio / sourceRatio,
  );
  return visibleFraction < 0.65 ? "contain" : "cover";
}
