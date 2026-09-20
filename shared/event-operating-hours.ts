import type { DateRange } from "./domain";

export type EventOperatingHours = {
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  human_time_text: string | null;
};

export type OperatingHoursClassification =
  | "EVENT_WIDE"
  | "PROGRAM_ONLY"
  | "AMBIGUOUS";

const timePattern = "(?:[01]\\d|2[0-3]):[0-5]\\d";

export function validOperatingTime(value: string | null): boolean {
  return value === null || new RegExp(`^${timePattern}$`).test(value);
}

function samePresentation(a: EventOperatingHours, b: EventOperatingHours) {
  if (a.start_time && a.end_time && b.start_time && b.end_time)
    return a.start_time === b.start_time && a.end_time === b.end_time;
  return (
    a.start_time === b.start_time &&
    a.end_time === b.end_time &&
    a.human_time_text === b.human_time_text
  );
}

export function selectOperatingHours(
  rows: EventOperatingHours[],
  selectedRange: DateRange,
): EventOperatingHours | null {
  const matching = rows.filter(
    (row) =>
      row.start_date <= selectedRange.end &&
      row.end_date >= selectedRange.start,
  );
  if (!matching.length) return null;

  const first = matching[0];
  return matching.every((row) => samePresentation(row, first)) ? first : null;
}

export function formatOperatingHours(row: EventOperatingHours | null) {
  if (!row) return null;
  if (row.start_time && row.end_time)
    return `${row.start_time} ~ ${row.end_time}`;
  return row.human_time_text?.trim() || null;
}

export function classifyOperatingHoursEvidence(
  evidence: string,
): OperatingHoursClassification {
  const text = evidence.replace(/\\s+/g, " ").trim();
  const programOnly =
    /(공연|불꽃|퍼레이드|개막식|폐막식|프로그램|공연시간|회차)/.test(text);
  const eventWide =
    /(행사 운영|행사장 운영|축제 운영|운영시간|입장 가능|관람 가능)/.test(
      text,
    );
  if (programOnly && !eventWide) return "PROGRAM_ONLY";
  if (eventWide && !programOnly) return "EVENT_WIDE";
  return "AMBIGUOUS";
}
