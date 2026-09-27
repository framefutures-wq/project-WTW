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
  | "FIRST_PARTY_DIRECT"
  | "DISCOVERED_OFFICIAL"
  | "TOURAPI_ONLY"
  | "MISSING";

export type AuditedPublishQualityRow = PublishQualityAuditRow & {
  proposed: PublishQualityDecision;
  official_link_quality: OfficialLinkQuality;
};

function isHttps(value: string | null | undefined) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function officialLinkQuality(
  row: PublishQualityAuditRow,
): OfficialLinkQuality {
  if (
    ["organizer", "municipality"].includes(row.source_kind ?? "") &&
    isHttps(row.source_url)
  )
    return "FIRST_PARTY_DIRECT";
  if (isHttps(row.discovered_official_url)) return "DISCOVERED_OFFICIAL";
  if (row.source_kind === "tourapi" && isHttps(row.source_url))
    return "TOURAPI_ONLY";
  return "MISSING";
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

export function auditPublishQualityRows(
  rows: PublishQualityAuditRow[],
  exampleLimit = 8,
) {
  const audited: AuditedPublishQualityRow[] = rows.map((row) => ({
    ...row,
    proposed: decidePublishQuality(row),
    official_link_quality: officialLinkQuality(row),
  }));
  const by_state: Record<PublishQualityState, number> = {
    PUBLIC: 0,
    HOLD: 0,
    EXCLUDE: 0,
  };
  const by_reason: Record<string, number> = {};
  const by_source_kind: Record<string, Record<PublishQualityState, number>> = {};
  const by_official_link_quality: Record<OfficialLinkQuality, number> = {
    FIRST_PARTY_DIRECT: 0,
    DISCOVERED_OFFICIAL: 0,
    TOURAPI_ONLY: 0,
    MISSING: 0,
  };

  for (const row of audited) {
    by_state[row.proposed.state] += 1;
    increment(by_reason, row.proposed.reason);
    by_official_link_quality[row.official_link_quality] += 1;
    const source = row.source_kind ?? "unknown";
    by_source_kind[source] ??= { PUBLIC: 0, HOLD: 0, EXCLUDE: 0 };
    by_source_kind[source][row.proposed.state] += 1;
  }

  const examples: Record<string, Array<{
    id: string;
    title: string;
    region: string;
    source_kind: string | null | undefined;
    source_name: string | null | undefined;
    reason: string;
    official_link_quality: OfficialLinkQuality;
    source_url: string | null | undefined;
    discovered_official_url: string | null | undefined;
  }>> = {};

  for (const state of ["HOLD", "EXCLUDE"] as const) {
    for (const row of audited.filter((item) => item.proposed.state === state)) {
      const key = `${state}:${row.proposed.reason}`;
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
    examples,
    audited,
  };
}
