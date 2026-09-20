import assert from "node:assert/strict";
import test from "node:test";
import { selectProgramOccurrence, selectProgramOccurrenceGroup } from "../shared/program-occurrence-selection";
const rows = [{start_date:"2026-09-19",end_date:"2026-09-19",start_time:"20:30",end_time:null,human_time_text:null,venue:null},{start_date:"2026-09-20",end_date:"2026-09-20",start_time:"20:30",end_time:null,human_time_text:null,venue:null}];
test("program occurrence selection prefers current, future, then the most recent past occurrence", () => {
  assert.equal(selectProgramOccurrence(rows,"2026-09-20")?.start_date,"2026-09-20");
  assert.equal(selectProgramOccurrence(rows,"2026-09-18")?.start_date,"2026-09-19");
  assert.equal(selectProgramOccurrence(rows,"2026-09-21")?.start_date,"2026-09-20");
});

test("selected occurrence date retains every same-day performance round", () => {
  const rounds = [
    { start_date: "2026-09-27", end_date: "2026-09-27", start_time: "20:00", end_time: null, human_time_text: null, venue: "광안리 해변" },
    { start_date: "2026-09-27", end_date: "2026-09-27", start_time: "22:00", end_time: null, human_time_text: null, venue: "광안리 해변" },
    { start_date: "2026-10-04", end_date: "2026-10-04", start_time: "19:00", end_time: null, human_time_text: null, venue: "광안리 해변" },
  ];
  assert.deepEqual(selectProgramOccurrenceGroup(rounds, "2026-09-20").map((row) => row.start_time), ["20:00", "22:00"]);
});

test("same-day royal and Sungnyemun rounds remain grouped", () => {
  const royal = [
    { start_date: "2026-09-20", end_date: "2026-09-20", start_time: "11:00", end_time: "11:30", human_time_text: null, venue: "덕수궁 대한문" },
    { start_date: "2026-09-20", end_date: "2026-09-20", start_time: "14:00", end_time: "14:30", human_time_text: null, venue: "덕수궁 대한문" },
  ];
  const sungnyemun = [
    { start_date: "2026-09-20", end_date: "2026-09-20", start_time: "10:10", end_time: "12:00", human_time_text: null, venue: "숭례문 광장" },
    { start_date: "2026-09-20", end_date: "2026-09-20", start_time: "13:00", end_time: "15:30", human_time_text: null, venue: "숭례문 광장" },
  ];
  assert.equal(selectProgramOccurrenceGroup(royal, "2026-09-20").length, 2);
  assert.equal(selectProgramOccurrenceGroup(sungnyemun, "2026-09-20").length, 2);
});
