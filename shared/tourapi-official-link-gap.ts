export type TourApiGapSignal =
  | "EXPLICIT_HTTP_HOMEPAGE"
  | "EXPLICIT_BARE_HOST"
  | "OTHER_HTTPS_URL"
  | "OTHER_HTTP_URL"
  | "NO_URL_SIGNAL"
  | "INVALID_DETAIL_PAYLOAD";

export type TourApiGapSignalInput = {
  base_raw_payload: string | null;
  detail_raw_payload: string | null;
};

function decode(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function payloadObject(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function explicitHomepageValues(detail: Record<string, unknown> | null) {
  if (!detail) return [];
  const common =
    detail.common && typeof detail.common === "object"
      ? (detail.common as Record<string, unknown>)
      : {};
  const intro =
    detail.intro && typeof detail.intro === "object"
      ? (detail.intro as Record<string, unknown>)
      : {};
  return [intro.eventhomepage, common.homepage]
    .map((value) => decode(String(value ?? "")).trim())
    .filter(Boolean);
}

function allStrings(value: unknown, out: string[] = []) {
  if (typeof value === "string") out.push(decode(value));
  else if (Array.isArray(value)) for (const item of value) allStrings(item, out);
  else if (value && typeof value === "object")
    for (const item of Object.values(value as Record<string, unknown>))
      allStrings(item, out);
  return out;
}

function hasUrl(strings: string[], protocol: "https" | "http") {
  const pattern =
    protocol === "https"
      ? /https:\/\/[^\s"'<>]+/i
      : /http:\/\/[^\s"'<>]+/i;
  return strings.some((value) => pattern.test(value));
}

export function classifyTourApiGapSignal(
  input: TourApiGapSignalInput,
): TourApiGapSignal {
  const detail = payloadObject(input.detail_raw_payload);
  if (input.detail_raw_payload && !detail) return "INVALID_DETAIL_PAYLOAD";

  const homepageValues = explicitHomepageValues(detail);
  if (homepageValues.some((value) => /http:\/\//i.test(value)))
    return "EXPLICIT_HTTP_HOMEPAGE";
  if (
    homepageValues.some(
      (value) =>
        !/https?:\/\//i.test(value) &&
        /(?:^|\s)(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/i.test(
          value,
        ),
    )
  )
    return "EXPLICIT_BARE_HOST";

  const strings = [
    ...allStrings(detail ?? {}),
    ...allStrings(payloadObject(input.base_raw_payload) ?? {}),
  ];
  if (hasUrl(strings, "https")) return "OTHER_HTTPS_URL";
  if (hasUrl(strings, "http")) return "OTHER_HTTP_URL";
  return "NO_URL_SIGNAL";
}
