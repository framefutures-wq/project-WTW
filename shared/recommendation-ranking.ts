import type { DateRange } from "./domain";

export type RecommendationReasonCode =
  | "within_selected_range"
  | "starts_in_selected_range"
  | "ends_in_selected_range"
  | "ongoing_through_range"
  | "single_day";

type RankableEvent = { id: string; start_date: string; end_date: string };

export function recommendationBucket(
  event: RankableEvent,
  range: DateRange,
): 0 | 1 | 2 | 3 {
  if (event.start_date >= range.start && event.end_date <= range.end) return 0;
  if (event.start_date >= range.start && event.start_date <= range.end) return 1;
  if (event.end_date >= range.start && event.end_date <= range.end) return 2;
  return 3;
}

export function recommendationReasonCodes(
  event: RankableEvent,
  range: DateRange,
): RecommendationReasonCode[] {
  const reason: RecommendationReasonCode[] = [
    ["within_selected_range", "starts_in_selected_range", "ends_in_selected_range", "ongoing_through_range"][recommendationBucket(event, range)] as RecommendationReasonCode,
  ];
  if (event.start_date === event.end_date) reason.push("single_day");
  return reason;
}

export function compareRecommended(
  a: RankableEvent,
  b: RankableEvent,
  range: DateRange,
) {
  const duration = (event: RankableEvent) =>
    Date.parse(`${event.end_date}T00:00:00Z`) -
    Date.parse(`${event.start_date}T00:00:00Z`);
  return (
    recommendationBucket(a, range) - recommendationBucket(b, range) ||
    Number(a.start_date !== a.end_date) - Number(b.start_date !== b.end_date) ||
    duration(a) - duration(b) ||
    a.start_date.localeCompare(b.start_date) ||
    a.end_date.localeCompare(b.end_date) ||
    a.id.localeCompare(b.id)
  );
}
