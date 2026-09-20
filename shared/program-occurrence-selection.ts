import type { EventProgramOccurrence } from "./domain";
export function selectProgramOccurrence(occurrences: EventProgramOccurrence[], referenceDate: string) {
  return occurrences.find((item) => item.start_date <= referenceDate && item.end_date >= referenceDate)
    ?? occurrences.find((item) => item.start_date > referenceDate)
    ?? occurrences.at(-1)
    ?? null;
}

export function selectProgramOccurrenceGroup(
  occurrences: EventProgramOccurrence[],
  referenceDate: string,
) {
  const selected = selectProgramOccurrence(occurrences, referenceDate);
  if (!selected) return [];
  return occurrences.filter(
    (item) =>
      item.start_date === selected.start_date && item.end_date === selected.end_date,
  );
}
