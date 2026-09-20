import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/App.tsx", "utf8");

test("public detail hides raw evidence and only links verified official pages", () => {
  assert.doesNotMatch(app, /TourAPI 원문 보기/);
  assert.doesNotMatch(app, /정보 확인 근거/);
  assert.doesNotMatch(app, /detail\.evidence\.map/);
  assert.match(app, /hasOfficialSource\(detail\.event\)/);
  assert.match(app, /detail\.event\.trust_source_url/);
});

test("unknown optional rows are hidden while visit-critical status remains visible", () => {
  assert.match(app, /detail\.event\.pet_policy !== "unknown"/);
  assert.doesNotMatch(app, /비용 정보 확인 필요/);
  assert.match(app, /개최 여부는 출발 전 공식 안내를 확인해 주세요/);
  assert.match(app, /전화하기/);
});

test("detail enrichment renders only populated summaries, highlights and programs", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(app, /detail\.enrichment\?\.summary/);
  assert.match(app, />주요 볼거리</);
  assert.match(app, />놓치지 마세요</);
  assert.match(app, /detailProgramSchedule/);
  assert.match(app, /detail\.enrichment\?\.programs\.some/);
});
