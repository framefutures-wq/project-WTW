import {
  decidePublishQuality,
  type PublishQualityState,
} from "./publish-quality";

export type StoredTourApiGap = {
  id: string;
  title: string;
  description?: string | null;
  venue?: string | null;
  address?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  current_publish_quality_state?: PublishQualityState | null;
  detail_source_id: string;
  detail_raw_payload: string | null;
};

const BLOCKED_OFFICIAL_LINK_HOSTS = [
  "data.go.kr",
  "apis.data.go.kr",
  "api.visitkorea.or.kr",
  "apis.visitkorea.or.kr",
] as const;

function safeExplicitHomepage(value: unknown) {
  const raw = String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/gi, "&")
    .trim();
  if (!raw) return null;
  const match = raw.match(/https:\/\/[^\s"'<>]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    const host = url.hostname.toLowerCase();
    if (
      BLOCKED_OFFICIAL_LINK_HOSTS.some(
        (blocked) => host === blocked || host.endsWith(`.${blocked}`),
      )
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function explicitOfficialHomepageFromStoredDetail(
  rawPayload: string | null,
) {
  if (!rawPayload) return null;
  try {
    const payload = JSON.parse(rawPayload) as {
      common?: Record<string, unknown>;
      intro?: Record<string, unknown>;
    };
    return (
      safeExplicitHomepage(payload.intro?.eventhomepage) ??
      safeExplicitHomepage(payload.common?.homepage)
    );
  } catch {
    return null;
  }
}

export type TourApiOfficialLinkBackfillCandidate = {
  event_id: string;
  source_id: string;
  url: string;
  previous_state: PublishQualityState;
  next_state: PublishQualityState;
  next_reason: string;
};

export function planTourApiOfficialLinkBackfill(
  rows: StoredTourApiGap[],
): TourApiOfficialLinkBackfillCandidate[] {
  return rows.flatMap((row) => {
    const url = explicitOfficialHomepageFromStoredDetail(
      row.detail_raw_payload,
    );
    if (!url) return [];

    const previous = row.current_publish_quality_state ?? "PUBLIC";
    const quality = decidePublishQuality({
      title: row.title,
      description: row.description,
      start_date: row.start_date,
      end_date: row.end_date,
      venue: row.venue,
      address: row.address,
      source_kind: "tourapi",
      source_url: "https://www.data.go.kr/data/15101578/openapi.do",
      event_official_url: url,
    });

    return [
      {
        event_id: row.id,
        source_id: row.detail_source_id,
        url,
        previous_state: previous,
        next_state: quality.state,
        next_reason: quality.reason,
      },
    ];
  });
}

export function validateTourApiOfficialLinkBackfill(
  candidates: TourApiOfficialLinkBackfillCandidate[],
) {
  const blockers: string[] = [];
  const seen = new Set<string>();

  if (candidates.length > 500) blockers.push("candidate_count_over_500");

  for (const candidate of candidates) {
    if (seen.has(candidate.event_id)) blockers.push("duplicate_event_id");
    seen.add(candidate.event_id);
    if (!candidate.url.startsWith("https://"))
      blockers.push("non_https_official_url");
    if (candidate.next_state === "EXCLUDE")
      blockers.push("backfill_would_exclude_event");
    if (
      candidate.previous_state === "PUBLIC" &&
      candidate.next_state !== "PUBLIC"
    )
      blockers.push("backfill_would_hide_public_event");
  }

  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    promotions: candidates.filter(
      (candidate) =>
        candidate.previous_state === "HOLD" &&
        candidate.next_state === "PUBLIC",
    ).length,
  };
}
