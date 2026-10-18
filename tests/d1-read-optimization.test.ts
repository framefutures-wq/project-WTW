import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("목록 API는 recommended/date page를 DB LIMIT/OFFSET으로 제한한다", () => {
  const source = readFileSync("worker/index.ts", "utf8");
  assert.match(source, /const recommendedOrder = `CASE/);
  assert.match(source, /ORDER BY \$\{orderBy\} LIMIT \? OFFSET \?/);
  assert.match(source, /rankingBinds/);
  assert.match(source, /includeTotal.*!== "0"/s);
  assert.match(source, /e\.id IN \(SELECT t\.event_id FROM event_tags/);
  assert.match(source, /FACT_CLASSIFIER/);
  assert.match(source, /FACT_RULE_VERSION/);
  assert.match(source, /USER_CONTENT_FILTER_BY_QUERY/);
});

test("원격 전체 읽기는 명시적인 비용 승인 flag가 필요하다", () => {
  const guard = readFileSync("scripts/remote-read-guard.mjs", "utf8");
  const snapshot = readFileSync("scripts/real-snapshot.mjs", "utf8");
  assert.match(guard, /allow-expensive-remote-read/);
  assert.match(snapshot, /requireRemoteReadApproval/);
});
