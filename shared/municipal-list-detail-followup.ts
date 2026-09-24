import { normalizeMunicipalTitle } from "./municipal-duplicate";
import {
  parseGenericMunicipalDetail,
  parseGenericMunicipalDetailCore,
  type MunicipalCandidate,
  type MunicipalListDetailPartial,
} from "./municipal-discovery";
import {
  municipalSourceAllowsUrl,
  type MunicipalSourceDefinition,
} from "./municipal-source-registry";

/** A registry declaration cannot turn a source run into an unbounded crawler. */
export const MAX_MUNICIPAL_LIST_DETAIL_FETCHES = 10;

export type MunicipalDetailFetch = (url: string) => Promise<{
  html: string;
  finalUrl: string;
}>;

export type MunicipalListDetailFollowupResult = {
  candidates: Array<{ candidate: MunicipalCandidate; detailHtml: string }>;
  attempted: number;
  rejected: Array<{ url: string; reason: string }>;
};

const maxDetailsFor = (source: MunicipalSourceDefinition) => {
  const declared = source.listDetailFollowup?.maxDetails;
  return Number.isInteger(declared) &&
    declared! >= 1 &&
    declared! <= MAX_MUNICIPAL_LIST_DETAIL_FETCHES
    ? declared!
    : 0;
};

const priority = (candidate: MunicipalListDetailPartial, current: string) => {
  if (candidate.start_date && candidate.end_date) {
    if (candidate.start_date <= current && candidate.end_date >= current)
      return 0;
    if (candidate.start_date > current) return 1;
    return 2;
  }
  return 3;
};

/** Active, nearest future, later future, ended, then date-less stable identities. */
export function selectMunicipalListDetailTargets(
  partials: readonly MunicipalListDetailPartial[],
  current: string,
  limit: number,
) {
  const unique = new Map<string, MunicipalListDetailPartial>();
  for (const partial of partials)
    if (!unique.has(partial.official_url))
      unique.set(partial.official_url, partial);
  return [...unique.values()]
    .sort((left, right) => {
      const leftPriority = priority(left, current);
      const rightPriority = priority(right, current);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (leftPriority <= 2) {
        const date = (
          leftPriority === 0 ? left.end_date : left.start_date
        )!.localeCompare(
          (rightPriority === 0 ? right.end_date : right.start_date)!,
        );
        if (date) return date;
      }
      return `${left.source_candidate_id}|${left.official_url}`.localeCompare(
        `${right.source_candidate_id}|${right.official_url}`,
      );
    })
    .slice(0, limit);
}

const titleMatches = (listTitle: string, detailTitle: string) => {
  const list = normalizeMunicipalTitle(listTitle);
  const detail = normalizeMunicipalTitle(detailTitle);
  return Boolean(
    list && detail && (list.includes(detail) || detail.includes(list)),
  );
};

const listDetailConflict = (
  partial: MunicipalListDetailPartial,
  detail: MunicipalCandidate,
) =>
  Boolean(
    (partial.start_date && partial.start_date !== detail.start_date) ||
    (partial.end_date && partial.end_date !== detail.end_date) ||
    (partial.venue && partial.venue !== detail.venue),
  );

/**
 * Completes only explicitly opted-in list observations. Every success contains
 * independently explicit detail core; failed detail reads stay isolated.
 */
export async function followUpMunicipalListDetails(
  source: MunicipalSourceDefinition,
  partials: readonly MunicipalListDetailPartial[],
  current: string,
  fetchDetail: MunicipalDetailFetch,
): Promise<MunicipalListDetailFollowupResult> {
  const cap = maxDetailsFor(source);
  const result: MunicipalListDetailFollowupResult = {
    candidates: [],
    attempted: 0,
    rejected: [],
  };
  if (!cap) return result;
  for (const partial of selectMunicipalListDetailTargets(
    partials,
    current,
    cap,
  )) {
    if (!municipalSourceAllowsUrl(source, partial.official_url)) {
      result.rejected.push({
        url: partial.official_url,
        reason: "detail_host_not_allowed",
      });
      continue;
    }
    result.attempted += 1;
    try {
      const response = await fetchDetail(partial.official_url);
      if (!municipalSourceAllowsUrl(source, response.finalUrl)) {
        result.rejected.push({
          url: partial.official_url,
          reason: "detail_redirect_host_not_allowed",
        });
        continue;
      }
      const detail = parseGenericMunicipalDetail(source, response.html);
      const core = parseGenericMunicipalDetailCore(response.html);
      const title = detail?.title ?? core.title;
      const venue = detail?.venue ?? core.venue;
      const start_date = detail?.start_date ?? core.start_date ?? partial.start_date;
      const end_date = detail?.end_date ?? core.end_date ?? partial.end_date;
      if (!title || !start_date || !end_date || !venue) {
        result.rejected.push({
          url: partial.official_url,
          reason: "detail_missing_core",
        });
        continue;
      }
      if (!titleMatches(partial.title, title)) {
        result.rejected.push({
          url: partial.official_url,
          reason: "detail_title_mismatch",
        });
        continue;
      }
      const completed: MunicipalCandidate = {
        source: partial.source,
        source_candidate_id: partial.source_candidate_id,
        title,
        start_date,
        end_date,
        region: partial.region,
        locality: partial.locality,
        venue,
        official_url: partial.official_url,
        category: partial.category ?? detail?.category ?? core.category,
        snippet: partial.snippet ?? null,
        image_candidate: null,
      };
      if (listDetailConflict(partial, completed)) {
        result.rejected.push({
          url: partial.official_url,
          reason: "list_detail_core_conflict",
        });
        continue;
      }
      result.candidates.push({
        candidate: completed,
        detailHtml: response.html,
      });
    } catch {
      result.rejected.push({
        url: partial.official_url,
        reason: "detail_fetch_failed",
      });
    }
  }
  return result;
}
