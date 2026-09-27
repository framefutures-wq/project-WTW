const GENERIC_TOURAPI_DESCRIPTION = "한국관광공사 TourAPI에 등록된 행사입니다.";

export type EventDetailBrief = {
  text: string | null;
  truncated: boolean;
};

function normalized(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cutAtWordBoundary(value: string, limit: number) {
  const slice = value.slice(0, limit + 1);
  const boundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("다. "),
    slice.lastIndexOf("요. "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (boundary >= Math.floor(limit * 0.55))
    return slice.slice(0, boundary + 1).trim();
  const space = slice.lastIndexOf(" ");
  return (space >= Math.floor(limit * 0.7) ? slice.slice(0, space) : value.slice(0, limit)).trim();
}

export function eventDetailBrief(
  value: string | null | undefined,
  maxLength = 360,
): EventDetailBrief {
  const text = normalized(value);
  if (!text || text.startsWith(GENERIC_TOURAPI_DESCRIPTION))
    return { text: null, truncated: false };
  if (text.length <= maxLength) return { text, truncated: false };

  const brief = cutAtWordBoundary(text, maxLength).replace(/[,:;·\-/]+$/u, "").trim();
  return {
    text: brief ? `${brief}…` : null,
    truncated: true,
  };
}
