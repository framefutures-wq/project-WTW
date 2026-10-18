import assert from "node:assert/strict";
import test from "node:test";
import { decideAutonomousMunicipal } from "../shared/municipal-autonomous";
import { parseHwaseongList } from "../shared/municipal-discovery";

const valid = { gate: "MAIN" as const, duplicate: "NEW" as const, temporal: "UPCOMING" as const, trusted: true, coreValid: true };
test("autonomous decision publishes only complete trusted MAIN + NEW candidates", () => {
  assert.equal(decideAutonomousMunicipal(valid).state, "AUTO_PUBLISH");
  assert.equal(decideAutonomousMunicipal({ ...valid, parserError: true }).state, "AUTO_RETRY");
  assert.equal(decideAutonomousMunicipal({ ...valid, coreConflict: true }).state, "AUTO_RETRY");
  assert.equal(decideAutonomousMunicipal({ ...valid, duplicate: "LIKELY_DUPLICATE" }).state, "AUTO_RETRY");
  assert.equal(decideAutonomousMunicipal({ ...valid, gate: "EXCLUDE" }).state, "AUTO_EXCLUDE");
  assert.equal(decideAutonomousMunicipal({ ...valid, gate: "NEARBY_ONLY" }).state, "POLICY_SKIP");
  assert.equal(decideAutonomousMunicipal({ ...valid, temporal: "EXPIRED" }).state, "EXPIRED");
});

test("Hwaseong canonical identity is independent of table row order and date", () => {
  const base = (number: number, date: string) => `<h1>2026년 화성시 주요 축제·행사 일정</h1><table class="listBoard"><tbody><tr><td>${number}</td><td>${date}</td><td>정조효문화제·정조대왕능행차</td><td>문화예술과</td><td>정조효공원·융건릉</td><td>화성시</td></tr></tbody></table>`;
  assert.equal(parseHwaseongList(base(8, "10. 3.(토)"))[0].source_candidate_id, parseHwaseongList(base(5, "10. 10.(토)"))[0].source_candidate_id);
});
