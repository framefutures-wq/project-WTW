import { validDate, type EventDetailProgram } from "./domain";

export type EventDerivedInfo = {
  state: "upcoming" | "ongoing" | null;
  dDay: string | null;
  duration: string | null;
  weekday: string | null;
  todayPrograms: string[];
};

const weekdays = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
];

const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`);

const occursToday = (
  program: EventDetailProgram,
  today: string,
) =>
  program.occurrences.some(
    (occurrence) =>
      validDate(occurrence.start_date) &&
      validDate(occurrence.end_date) &&
      occurrence.start_date <= today &&
      occurrence.end_date >= today,
  ) || program.date === today;

export function deriveEventDetailInfo({
  startDate,
  endDate,
  programs = [],
  today,
}: {
  startDate: string;
  endDate: string;
  programs?: EventDetailProgram[];
  today: string;
}): EventDerivedInfo {
  if (
    !validDate(startDate) ||
    !validDate(endDate) ||
    !validDate(today) ||
    startDate > endDate
  ) {
    return {
      state: null,
      dDay: null,
      duration: null,
      weekday: null,
      todayPrograms: [],
    };
  }

  const durationDays =
    Math.floor((utcDay(endDate) - utcDay(startDate)) / 86_400_000) + 1;
  const state =
    today < startDate ? "upcoming" : today <= endDate ? "ongoing" : null;
  const daysUntilStart = Math.floor(
    (utcDay(startDate) - utcDay(today)) / 86_400_000,
  );
  const todayPrograms =
    state === "ongoing"
      ? [
          ...new Set(
            programs
              .filter((program) => occursToday(program, today))
              .map((program) => program.name),
          ),
        ]
      : [];

  return {
    state,
    dDay:
      today === startDate
        ? "D-DAY"
        : state === "upcoming"
          ? `D-${daysUntilStart}`
          : null,
    duration: durationDays === 1 ? "하루 행사" : `${durationDays}일간`,
    weekday: weekdays[new Date(`${startDate}T00:00:00Z`).getUTCDay()],
    todayPrograms,
  };
}
