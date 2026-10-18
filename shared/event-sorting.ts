import type { DateRange, EventItem } from "./domain";

type SortableEvent = Pick<EventItem, "id" | "start_date" | "end_date">;

/**
 * Date order contract for a selected range. Events that start in the range
 * appear before events that were already running, then all keys are stable.
 */
export function compareDateOrder(
  a: SortableEvent,
  b: SortableEvent,
  range: DateRange,
): number {
  const aStartsInRange = a.start_date >= range.start && a.start_date <= range.end;
  const bStartsInRange = b.start_date >= range.start && b.start_date <= range.end;
  return (
    Number(bStartsInRange) - Number(aStartsInRange) ||
    a.start_date.localeCompare(b.start_date) ||
    a.end_date.localeCompare(b.end_date) ||
    a.id.localeCompare(b.id)
  );
}
