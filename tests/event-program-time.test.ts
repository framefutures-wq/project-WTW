import assert from "node:assert/strict";
import test from "node:test";
import { formatProgramTime, validProgramTime } from "../shared/event-program-time";
test("program times accept only real 24-hour clock values", () => {
  for (const value of [null, "00:00", "09:30", "19:30", "23:59"]) assert.equal(validProgramTime(value), true);
  for (const value of ["24:00", "29:30", "-1:00", "99:99"]) assert.equal(validProgramTime(value), false);
});

test("program time formatter uses 낮 only for exact noon", () => {
  assert.equal(formatProgramTime("00:00"), "오전 12:00");
  assert.equal(formatProgramTime("08:00"), "오전 8:00");
  assert.equal(formatProgramTime("11:30"), "오전 11:30");
  assert.equal(formatProgramTime("12:00"), "낮 12:00");
  assert.equal(formatProgramTime("12:30"), "오후 12:30");
  assert.equal(formatProgramTime("13:00"), "오후 1:00");
  assert.equal(formatProgramTime("20:00"), "오후 8:00");
  assert.equal(formatProgramTime("22:00"), "오후 10:00");
});
