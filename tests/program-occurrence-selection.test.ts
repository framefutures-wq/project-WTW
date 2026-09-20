import assert from "node:assert/strict";
import test from "node:test";
import { selectProgramOccurrence } from "../shared/program-occurrence-selection";
const rows = [{start_date:"2026-09-19",end_date:"2026-09-19",start_time:"20:30",end_time:null,human_time_text:null,venue:null},{start_date:"2026-09-20",end_date:"2026-09-20",start_time:"20:30",end_time:null,human_time_text:null,venue:null}];
test("program occurrence selection prefers current, future, then the most recent past occurrence", () => {
  assert.equal(selectProgramOccurrence(rows,"2026-09-20")?.start_date,"2026-09-20");
  assert.equal(selectProgramOccurrence(rows,"2026-09-18")?.start_date,"2026-09-19");
  assert.equal(selectProgramOccurrence(rows,"2026-09-21")?.start_date,"2026-09-20");
});
