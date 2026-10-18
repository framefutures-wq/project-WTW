import type { MunicipalCandidate } from "./municipal-discovery";
import {
  municipalSourceAllowsUrl,
  type MunicipalSourceDefinition,
} from "./municipal-source-registry";

/** A registry value can never turn one source into an unbounded crawler. */
export const MAX_MUNICIPAL_PAGINATION_PAGES = 3;
/** A single canonical list may exceed the downstream budget, but not become unbounded. */
export const MAX_MUNICIPAL_SINGLE_LIST_CANDIDATES = 100;

const validPagination = (
  pagination: MunicipalSourceDefinition["pagination"],
): pagination is NonNullable<MunicipalSourceDefinition["pagination"]> =>
  Boolean(
    pagination &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(pagination.queryParam) &&
    Number.isInteger(pagination.maxPages) &&
    pagination.maxPages >= 1 &&
    pagination.maxPages <= MAX_MUNICIPAL_PAGINATION_PAGES,
  );

/** Returns null for an unsafe registry declaration instead of guessing a URL. */
export function municipalSourcePageUrls(
  source: MunicipalSourceDefinition,
): string[] | null {
  if (!source.pagination) return [source.url];
  if (!validPagination(source.pagination)) return null;
  const urls: string[] = [];
  try {
    for (let page = 1; page <= source.pagination.maxPages; page += 1) {
      const url = new URL(source.url);
      url.searchParams.set(source.pagination.queryParam, String(page));
      if (!municipalSourceAllowsUrl(source, url.toString())) return null;
      urls.push(url.toString());
    }
  } catch {
    return null;
  }
  return urls;
}

const priority = (candidate: MunicipalCandidate, current: string) => {
  if (candidate.start_date && candidate.end_date) {
    if (candidate.start_date <= current && candidate.end_date >= current)
      return 0;
    if (candidate.start_date > current) return 1;
  }
  return 2;
};

const stableCandidateIdentity = (candidate: MunicipalCandidate) =>
  candidate.source_candidate_id || candidate.official_url;

const compareCandidatePriority = (
  left: MunicipalCandidate,
  right: MunicipalCandidate,
  current: string,
) => {
  const leftPriority = priority(left, current);
  const rightPriority = priority(right, current);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftDate =
    leftPriority === 0 ? left.end_date ?? "" : left.start_date ?? left.end_date ?? "";
  const rightDate =
    rightPriority === 0 ? right.end_date ?? "" : right.start_date ?? right.end_date ?? "";
  const date = leftDate.localeCompare(rightDate);
  if (date) return date;
  return stableCandidateIdentity(left).localeCompare(stableCandidateIdentity(right));
};

/**
 * Applies the downstream source budget to a healthy single canonical list.
 * Lists at or below the budget retain parser order; overflow lists are
 * identity-deduped and prioritized deterministically.
 */
export function selectBoundedMunicipalCandidates<
  T extends { candidate: MunicipalCandidate },
>(items: readonly T[], current: string, limit: number): T[] {
  if (items.length > MAX_MUNICIPAL_SINGLE_LIST_CANDIDATES)
    throw new Error("source_candidate_circuit_breaker");
  if (items.length <= limit) return [...items];
  const unique = new Map<string, T>();
  for (const item of items) {
    const identity = stableCandidateIdentity(item.candidate);
    if (!unique.has(identity)) unique.set(identity, item);
  }
  return [...unique.values()]
    .sort((left, right) =>
      compareCandidatePriority(left.candidate, right.candidate, current),
    )
    .slice(0, limit);
}

/**
 * Keeps the first page observation for duplicate identities, then makes the
 * bounded downstream set useful even when the official list is newest-first.
 */
export function mergePaginatedMunicipalCandidates<
  T extends { candidate: MunicipalCandidate },
>(items: readonly T[], current: string): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    if (!unique.has(item.candidate.source_candidate_id))
      unique.set(item.candidate.source_candidate_id, item);
  }
  return [...unique.values()].sort((left, right) => {
    const leftPriority = priority(left.candidate, current);
    const rightPriority = priority(right.candidate, current);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (leftPriority === 1) {
      const date = (left.candidate.start_date ?? "").localeCompare(
        right.candidate.start_date ?? "",
      );
      if (date) return date;
    }
    return left.candidate.source_candidate_id.localeCompare(
      right.candidate.source_candidate_id,
    );
  });
}

export async function fetchMunicipalSourcePages<
  T extends { candidate: MunicipalCandidate },
>(
  source: MunicipalSourceDefinition,
  current: string,
  fetchPage: (url: string) => Promise<string>,
  parsePage: (html: string, url: string) => Promise<T[]>,
): Promise<T[]> {
  const urls = municipalSourcePageUrls(source);
  if (!urls) throw new Error("municipal_pagination_invalid");
  const pages: T[] = [];
  for (const url of urls)
    pages.push(...(await parsePage(await fetchPage(url), url)));
  return source.pagination
    ? mergePaginatedMunicipalCandidates(pages, current)
    : pages;
}
