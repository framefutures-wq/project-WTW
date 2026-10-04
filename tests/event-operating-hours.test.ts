import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOperatingHoursEvidence,
  formatEventOperatingHours,
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

test("same clock hours remain visible when a date has an optional human label", () => {
  const selected = selectOperatingHours(
    [
      { ...hours("2026-09-19", "2026-09-19", "18:00", "21:30"), human_time_text: null },
      { ...hours("2026-09-20", "2026-09-20", "18:00", "21:30"), human_time_text: "일요일 야간개장" },
    ],
    { start: "2026-09-19", end: "2026-09-20" },
  );
  assert.equal(formatOperatingHours(selected), "18:00 ~ 21:30");
});

test("program-only rows do not create an operating-hour card value", () => {
  assert.equal(classifyOperatingHoursEvidence("메인 공연 19:30"), "PROGRAM_ONLY");
  assert.equal(selectOperatingHours([], { start: "2026-09-20", end: "2026-09-20" }), null);
});


test("same-day multiple official sessions stay visible on detail", () => {
  const rows = [
    hours("2026-09-27", "2026-09-27", "15:00", "16:00"),
    hours("2026-09-27", "2026-09-27", "17:00", "18:00"),
  ];
  assert.equal(
    formatEventOperatingHours(rows, "2026-09-27", "2026-09-27"),
    "15:00 ~ 16:00 · 17:00 ~ 18:00",
  );
});

test("different multi-day hours remain hidden instead of being flattened", () => {
  const rows = [
    hours("2026-09-27", "2026-09-27", "15:00", "16:00"),
    hours("2026-09-28", "2026-09-28", "17:00", "18:00"),
  ];
  assert.equal(
    formatEventOperatingHours(rows, "2026-09-27", "2026-09-28"),
    null,
  );
});

test("detail hours use the event period when discovery selection is outside it", () => {
  const rows = [hours("2026-10-08", "2026-11-29", "10:00", "17:00")];
  const discoveryRange = { start: "2026-10-03", end: "2026-10-04" };
  assert.equal(discoveryRange.end < rows[0].start_date, true);
  assert.equal(
    formatEventOperatingHours(rows, "2026-10-08", "2026-11-29"),
    "10:00 ~ 17:00",
  );
});
