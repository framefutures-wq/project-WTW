import type { MunicipalCandidate } from "./municipal-discovery";
import {
  municipalSourceAllowsUrl,
  type MunicipalSourceDefinition,
} from "./municipal-source-registry";

/** A registry value can never turn one source into an unbounded crawler. */
export const MAX_MUNICIPAL_PAGINATION_PAGES = 3;

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
