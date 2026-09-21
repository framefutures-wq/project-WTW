import type { DateRange, Period } from "./domain";

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

const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"] as const;
const validDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const shortDate = (value: string) => {
  const [, month, day] = value.split("-");
  return `${Number(month)}.${Number(day)}`;
};
const weekday = (value: string) => WEEKDAYS[new Date(`${value}T00:00:00Z`).getUTCDay()];

export function recommendationReasonLabel(
  event: RankableEvent,
  range: DateRange,
  period: Period,
): string | null {
  if (!validDateOnly(event.start_date) || !validDateOnly(event.end_date)) return null;
  const codes = recommendationReasonCodes(event, range);
  if (codes.includes("single_day") && codes.includes("within_selected_range")) {
    if (period === "today" && event.start_date === range.start) return "오늘 하루";
    if (period === "weekend" || period === "next-weekend") return `${weekday(event.start_date)} 하루`;
    return `${shortDate(event.start_date)} 하루`;
  }
  if (codes.includes("within_selected_range")) {
    if (period === "weekend") return "이번 주말에만";
    if (period === "next-weekend") return "다음 주말에만";
    if (period === "today") return "오늘만";
    return "선택한 기간에 진행";
  }
  if (codes.includes("starts_in_selected_range")) {
    if (period === "today") return "오늘 시작";
    if (period === "weekend") return "이번 주말 시작";
    if (period === "next-weekend") return "다음 주말 시작";
    return "선택한 기간에 시작";
  }
  if (codes.includes("ends_in_selected_range")) {
    if (period === "today") return "오늘까지";
    if (period === "weekend" || period === "next-weekend") return `${weekday(event.end_date)}까지`;
    return `${shortDate(event.end_date)}까지`;
  }
  return null;
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
