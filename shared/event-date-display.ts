import type { DateRange, Period } from "./domain";

type EventDateDisplayInput = {
  eventStart: string;
  eventEnd: string;
  selectedRange: DateRange;
  selectionMode: Period;
};

const shortDate = (date: string, referenceYear: string) => {
  const [year, month, day] = date.split("-");
  return year === referenceYear
    ? `${Number(month)}.${Number(day)}`
    : `${Number(year)}.${Number(month)}.${Number(day)}`;
};

const continuingLabel = (selectionMode: Period, selectedRange: DateRange) => {
  if (selectionMode === "today") return "오늘도 진행";
  if (selectionMode === "weekend") return "이번 주말에도 진행";
  if (selectionMode === "next-weekend") return "다음 주말에도 진행";
  return selectedRange.start === selectedRange.end
    ? "선택한 날짜에도 진행"
    : "선택 기간에도 진행";
};

export function overlapsDateRange(
  eventStart: string,
  eventEnd: string,
  selectedRange: DateRange,
) {
  return eventStart <= selectedRange.end && eventEnd >= selectedRange.start;
}

export function formatEventDateLabel({
  eventStart,
  eventEnd,
  selectedRange,
  selectionMode,
}: EventDateDisplayInput) {
  const referenceYear = selectedRange.start.slice(0, 4);
  const start = shortDate(eventStart, referenceYear);
  const end = shortDate(eventEnd, referenceYear);

  if (eventStart < selectedRange.start && eventEnd >= selectedRange.start)
    return `${continuingLabel(selectionMode, selectedRange)} · ~ ${end}`;

  if (eventStart >= selectedRange.start && eventStart <= selectedRange.end) {
    if (eventStart === eventEnd) return `${start} 하루`;
    if (eventEnd <= selectedRange.end) return `${start} ~ ${end}`;
    return `${start} 시작 · ~ ${end}`;
  }

  return `${start} ~ ${end}`;
}
