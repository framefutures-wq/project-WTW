export type TourApiImagePayload = {
  firstimage?: unknown;
  firstimage2?: unknown;
};

function validTourApiImageUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (/\b(?:logo|favicon|sprite|icon)\b/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function tourApiPrimaryImage(raw: TourApiImagePayload) {
  return validTourApiImageUrl(raw.firstimage) ?? validTourApiImageUrl(raw.firstimage2);
}

export function tourApiSecondaryImage(raw: TourApiImagePayload) {
  const primary = tourApiPrimaryImage(raw);
  const secondary = validTourApiImageUrl(raw.firstimage2);
  return primary && secondary && primary !== secondary ? secondary : null;
}