import type { EventProgramOccurrence } from "./domain";
export function selectProgramOccurrence(occurrences: EventProgramOccurrence[], referenceDate: string) {
  return occurrences.find((item) => item.start_date <= referenceDate && item.end_date >= referenceDate)
    ?? occurrences.find((item) => item.start_date > referenceDate)
    ?? occurrences.at(-1)
    ?? null;
}
