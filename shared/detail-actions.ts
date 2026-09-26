import type { EventDetailEnrichment, EventItem } from "./domain";

const OFFICIAL_TRUST_SOURCE_TYPES = new Set([
  "event_official",
  "organizer_official",
  "local_government",
  "visitkorea",
]);

const safeHttpsUrl = (url: string | null | undefined) => {
  try {
    return url && new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

export function detailOfficialUrl(
  event: EventItem,
  enrichment: EventDetailEnrichment | null,
) {
  if (
    enrichment &&
    ["organizer", "municipality"].includes(enrichment.source_kind) &&
    enrichment.source_priority <= 2
  ) {
    const url = safeHttpsUrl(enrichment.source_url);
    if (url) return url;
  }

  if (
    event.trust_source_url &&
    event.trust_source_types.some((type) =>
      OFFICIAL_TRUST_SOURCE_TYPES.has(type),
    )
  ) {
    const url = safeHttpsUrl(event.trust_source_url);
    if (url) return url;
  }

  if (
    event.source_kind &&
    ["organizer", "municipality"].includes(event.source_kind)
  ) {
    return safeHttpsUrl(event.source_url);
  }

  return null;
}

export type DetailMapAction = {
  href: string;
  label: "길찾기" | "지도에서 보기";
};

export function detailMapAction(event: EventItem): DetailMapAction | null {
  if (
    typeof event.lat === "number" &&
    Number.isFinite(event.lat) &&
    typeof event.lng === "number" &&
    Number.isFinite(event.lng)
  ) {
    const name =
      event.venue.trim() || event.address.trim() || event.title.trim();
    return {
      href: `https://map.kakao.com/link/to/${encodeURIComponent(name)},${event.lat},${event.lng}`,
      label: "길찾기",
    };
  }

  const query = event.address.trim() || event.venue.trim();
  if (!query) return null;

  return {
    href: `https://map.kakao.com/link/search/${encodeURIComponent(query)}`,
    label: "지도에서 보기",
  };
}
