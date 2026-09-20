import assert from "node:assert/strict";
import test from "node:test";
import { validProgramTime } from "../shared/event-program-time";
test("program times accept only real 24-hour clock values", () => {
  for (const value of [null, "00:00", "09:30", "19:30", "23:59"]) assert.equal(validProgramTime(value), true);
  for (const value of ["24:00", "29:30", "-1:00", "99:99"]) assert.equal(validProgramTime(value), false);
});
