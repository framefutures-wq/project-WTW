import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOperatingHoursEvidence,
  formatOperatingHours,
  selectOperatingHours,
  validOperatingTime,
  type EventOperatingHours,
} from "../shared/event-operating-hours";

const hours = (start_date: string, end_date: string, start_time: string, end_time: string): EventOperatingHours => ({
  start_date,
  end_date,
  start_time,
  end_time,
  human_time_text: null,
});

test("event-wide and program-only evidence remain separate", () => {
  assert.equal(classifyOperatingHoursEvidence("행사 운영시간 18:00~21:30"), "EVENT_WIDE");
  assert.equal(classifyOperatingHoursEvidence("불꽃놀이 20:30"), "PROGRAM_ONLY");
  assert.equal(classifyOperatingHoursEvidence("저녁 시간 진행"), "AMBIGUOUS");
});

test("operating hours accept only real 24-hour values", () => {
  for (const value of ["00:00", "09:30", "19:30", "23:59"]) assert.equal(validOperatingTime(value), true);
  for (const value of ["24:00", "29:30", "-1:00", "99:99"]) assert.equal(validOperatingTime(value), false);
});

test("selected date chooses its exact operating-day row", () => {
  const selected = selectOperatingHours(
    [hours("2026-09-19", "2026-09-19", "10:00", "21:00"), hours("2026-09-20", "2026-09-20", "10:30", "20:30")],
    { start: "2026-09-20", end: "2026-09-20" },
  );
  assert.equal(formatOperatingHours(selected), "10:30 ~ 20:30");
});

test("same hours may represent a selected multi-day range, differing hours stay hidden", () => {
  const same = selectOperatingHours(
    [hours("2026-09-18", "2026-09-18", "10:00", "20:00"), hours("2026-09-19", "2026-09-19", "10:00", "20:00")],
    { start: "2026-09-18", end: "2026-09-19" },
  );
  assert.equal(formatOperatingHours(same), "10:00 ~ 20:00");
  assert.equal(
    selectOperatingHours(
      [hours("2026-09-18", "2026-09-18", "10:00", "20:00"), hours("2026-09-19", "2026-09-19", "11:00", "21:00")],
      { start: "2026-09-18", end: "2026-09-19" },
    ),
    null,
  );
});

test("program-only rows do not create an operating-hour card value", () => {
  assert.equal(classifyOperatingHoursEvidence("메인 공연 19:30"), "PROGRAM_ONLY");
  assert.equal(selectOperatingHours([], { start: "2026-09-20", end: "2026-09-20" }), null);
});
