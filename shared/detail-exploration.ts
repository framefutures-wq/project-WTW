import type { EventItem, Tag } from "./domain";

export function nearbyDetailEvents(events: EventItem[], currentId: string) {
  return events
    .filter(
      (event) =>
        event.id !== currentId &&
        event.distance_km !== null &&
        event.distance_km <= 30,
    )
    .sort(
      (a, b) =>
        (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) ||
        a.start_date.localeCompare(b.start_date),
    )
    .slice(0, 3);
}

export function similarDetailEvents(
  events: EventItem[],
  currentId: string,
  theme: Tag,
) {
  return events
    .filter((event) => event.id !== currentId && event.tags.includes(theme))
    .slice(0, 3);
}
