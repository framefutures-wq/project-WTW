import assert from "node:assert/strict";
import test from "node:test";
import { deriveEventDetailInfo } from "../shared/event-derived-info";
import type { EventDetailProgram } from "../shared/domain";

const program = (overrides: Partial<EventDetailProgram>): EventDetailProgram => ({
  name: "수문장 교대의식",
  date: null,
  start_time: null,
  end_time: null,
  schedule_text: null,
  venue: null,
  description: null,
  tags: [],
  featured: false,
  occurrences: [],
  ...overrides,
});

test("derived detail info reports a future D-day and Korean weekday", () => {
  const info = deriveEventDetailInfo({
    startDate: "2026-09-26",
    endDate: "2026-09-28",
    today: "2026-09-23",
  });
  assert.equal(info.state, "upcoming");
  assert.equal(info.dDay, "D-3");
  assert.equal(info.weekday, "토요일");
});

test("derived detail info shows D-DAY on the start date and ongoing afterwards", () => {
  assert.equal(
    deriveEventDetailInfo({
      startDate: "2026-09-23",
      endDate: "2026-09-25",
      today: "2026-09-23",
    }).dDay,
    "D-DAY",
  );
  const ongoing = deriveEventDetailInfo({
    startDate: "2026-09-23",
    endDate: "2026-09-25",
    today: "2026-09-24",
  });
  assert.equal(ongoing.state, "ongoing");
  assert.equal(ongoing.dDay, null);
});

test("derived detail info calculates single-day and multi-day durations", () => {
  assert.equal(
    deriveEventDetailInfo({
      startDate: "2026-09-23",
      endDate: "2026-09-23",
      today: "2026-09-20",
    }).duration,
    "하루 행사",
  );
  assert.equal(
    deriveEventDetailInfo({
      startDate: "2026-09-23",
      endDate: "2026-09-27",
      today: "2026-09-20",
    }).duration,
    "5일간",
  );
});

test("derived detail info selects only programs with an explicit occurrence or date today", () => {
  const info = deriveEventDetailInfo({
    startDate: "2026-09-23",
    endDate: "2026-09-25",
    today: "2026-09-24",
    programs: [
      program({
        occurrences: [
          {
            start_date: "2026-09-24",
            end_date: "2026-09-24",
            start_time: null,
            end_time: null,
            human_time_text: null,
            venue: null,
          },
        ],
      }),
      program({ name: "날짜 프로그램", date: "2026-09-24" }),
      program({ name: "추측 금지", schedule_text: "매일 공연" }),
    ],
  });
  assert.deepEqual(info.todayPrograms, ["수문장 교대의식", "날짜 프로그램"]);
});
