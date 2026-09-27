import {
  decidePublishQuality,
  type PublishQualityDecision,
  type PublishQualityInput,
  type PublishQualityState,
} from "./publish-quality";

export type PublishQualityAuditRow = PublishQualityInput & {
  id: string;
  region: string;
  source_name?: string | null;
  discovered_official_url?: string | null;
};

export type OfficialLinkQuality =
  | "EVENT_OFFICIAL_LINK"
  | "FIRST_PARTY_SOURCE_ONLY"
  | "TOURAPI_ONLY"
  | "MISSING";

export type PublicQualityRisk =
  | "NONE"
  | "PUBLIC_SPARSE"
  | "PUBLIC_OFFICIAL_LINK_GAP"
  | "PUBLIC_SPARSE_AND_LINK_GAP";

export type AuditedPublishQualityRow = PublishQualityAuditRow & {
  proposed: PublishQualityDecision;
  official_link_quality: OfficialLinkQuality;
  public_quality_risk: PublicQualityRisk;
};

function isHttps(value: string | null | undefined) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedDescription(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sparseDescription(value: string | null | undefined) {
  const text = normalizedDescription(value);
  return (
    text.length < 80 ||
    /^한국관광공사 TourAPI에 등록된 행사입니다/.test(text)
  );
}

export function officialLinkQuality(
  row: PublishQualityAuditRow,
): OfficialLinkQuality {
  if (isHttps(row.discovered_official_url)) return "EVENT_OFFICIAL_LINK";
  if (
    ["organizer", "municipality"].includes(row.source_kind ?? "") &&
    isHttps(row.source_url)
  )
    return "FIRST_PARTY_SOURCE_ONLY";
  if (row.source_kind === "tourapi" && isHttps(row.source_url))
    return "TOURAPI_ONLY";
  return "MISSING";
}

export function publicQualityRisk(
  row: PublishQualityAuditRow,
  proposed: PublishQualityDecision,
  linkQuality = officialLinkQuality(row),
): PublicQualityRisk {
  if (proposed.state !== "PUBLIC") return "NONE";
  const sparse = sparseDescription(row.description);
  const officialGap =
    linkQuality === "TOURAPI_ONLY" || linkQuality === "MISSING";
  if (sparse && officialGap) return "PUBLIC_SPARSE_AND_LINK_GAP";
  if (sparse) return "PUBLIC_SPARSE";
  if (officialGap) return "PUBLIC_OFFICIAL_LINK_GAP";
  return "NONE";
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

export function auditPublishQualityRows(
  rows: PublishQualityAuditRow[],
  exampleLimit = 8,
) {
  const audited: AuditedPublishQualityRow[] = rows.map((row) => {
    const proposed = decidePublishQuality(row);
    const official_link_quality = officialLinkQuality(row);
    return {
      ...row,
      proposed,
      official_link_quality,
      public_quality_risk: publicQualityRisk(
        row,
        proposed,
        official_link_quality,
      ),
    };
  });
  const by_state: Record<PublishQualityState, number> = {
    PUBLIC: 0,
    HOLD: 0,
    EXCLUDE: 0,
  };
  const by_reason: Record<string, number> = {};
  const by_source_kind: Record<string, Record<PublishQualityState, number>> = {};
  const by_official_link_quality: Record<OfficialLinkQuality, number> = {
    EVENT_OFFICIAL_LINK: 0,
    FIRST_PARTY_SOURCE_ONLY: 0,
    TOURAPI_ONLY: 0,
    MISSING: 0,
  };
  const by_public_quality_risk: Record<PublicQualityRisk, number> = {
    NONE: 0,
    PUBLIC_SPARSE: 0,
    PUBLIC_OFFICIAL_LINK_GAP: 0,
    PUBLIC_SPARSE_AND_LINK_GAP: 0,
  };

  for (const row of audited) {
    by_state[row.proposed.state] += 1;
    increment(by_reason, row.proposed.reason);
    by_official_link_quality[row.official_link_quality] += 1;
    by_public_quality_risk[row.public_quality_risk] += 1;
    const source = row.source_kind ?? "unknown";
    by_source_kind[source] ??= { PUBLIC: 0, HOLD: 0, EXCLUDE: 0 };
    by_source_kind[source][row.proposed.state] += 1;
  }

  const examples: Record<
    string,
    Array<{
      id: string;
      title: string;
      region: string;
      source_kind: string | null | undefined;
      source_name: string | null | undefined;
      reason: string;
      official_link_quality: OfficialLinkQuality;
      public_quality_risk: PublicQualityRisk;
      source_url: string | null | undefined;
      discovered_official_url: string | null | undefined;
    }>
  > = {};

  for (const row of audited) {
    const keys: string[] = [];
    if (row.proposed.state !== "PUBLIC")
      keys.push(`${row.proposed.state}:${row.proposed.reason}`);
    if (row.public_quality_risk !== "NONE")
      keys.push(`RISK:${row.public_quality_risk}`);
    for (const key of keys) {
      examples[key] ??= [];
      if (examples[key].length >= exampleLimit) continue;
      examples[key].push({
        id: row.id,
        title: row.title,
        region: row.region,
        source_kind: row.source_kind,
        source_name: row.source_name,
        reason: row.proposed.reason,
        official_link_quality: row.official_link_quality,
        public_quality_risk: row.public_quality_risk,
        source_url: row.source_url,
        discovered_official_url: row.discovered_official_url,
      });
    }
  }

  return {
    total: audited.length,
    by_state,
    by_reason,
    by_source_kind,
    by_official_link_quality,
    by_public_quality_risk,
    examples,
    audited,
  };
}
