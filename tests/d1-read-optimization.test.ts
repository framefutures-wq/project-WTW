import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("목록 API는 날짜순 page를 DB LIMIT/OFFSET으로 제한한다", () => {
  const source = readFileSync("worker/index.ts", "utf8");
  assert.match(source, /ORDER BY e\.start_date,e\.id LIMIT \? OFFSET \?/);
  assert.match(source, /includeTotal.*!== "0"/s);
  assert.match(source, /e\.id IN \(SELECT t\.event_id FROM event_tags/);
});

test("원격 전체 읽기는 명시적인 비용 승인 flag가 필요하다", () => {
  const guard = readFileSync("scripts/remote-read-guard.mjs", "utf8");
  const snapshot = readFileSync("scripts/real-snapshot.mjs", "utf8");
  assert.match(guard, /allow-expensive-remote-read/);
  assert.match(snapshot, /requireRemoteReadApproval/);
});
