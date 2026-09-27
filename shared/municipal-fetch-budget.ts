export const MUNICIPAL_MIN_FETCH_RESERVE_PER_SOURCE = 2;
export const MUNICIPAL_MAX_FETCHES_PER_SOURCE_WINDOW = 3;

export function municipalSourceFetchCeiling({
  used,
  hardLimit,
  remainingSources,
  minReservePerSource = MUNICIPAL_MIN_FETCH_RESERVE_PER_SOURCE,
  maxSourceWindow = MUNICIPAL_MAX_FETCHES_PER_SOURCE_WINDOW,
}: {
  used: number;
  hardLimit: number;
  remainingSources: number;
  minReservePerSource?: number;
  maxSourceWindow?: number;
}) {
  const reservedForLater = Math.max(0, remainingSources) * minReservePerSource;
  const coverageCeiling = Math.max(used, hardLimit - reservedForLater);
  return Math.min(hardLimit, coverageCeiling, used + maxSourceWindow);
}
