/** The bounded list exploration contract used by the client. */
export const PAGE_SIZE = 9;
export const PAGES_PER_BATCH = 4;
export const MAX_VISIBLE_ITEMS = PAGE_SIZE * PAGES_PER_BATCH;

export function batchStartPage(batchIndex: number): number {
  return batchIndex * PAGES_PER_BATCH + 1;
}

export function totalPages(total: number): number {
  return Math.ceil(total / PAGE_SIZE);
}

export function hasNextBatch(batchStart: number, total: number): boolean {
  return batchStart + PAGES_PER_BATCH <= totalPages(total);
}

export function uniqueEvents<T extends { id: string }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}
