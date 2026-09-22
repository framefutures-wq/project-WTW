import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/App.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const redesign = readFileSync("src/redesign.css", "utf8");

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
  assert.match(app, />주요 일정</);
  assert.match(app, /detailProgramSchedule/);
  assert.match(app, /detail\.enrichment\?\.programs\.some/);
});

test("detail v2 prioritizes date and venue, then CTA and populated content", () => {
  const primaryFacts = app.indexOf('className="detail-primary-facts"');
  const officialCta = app.indexOf("detail-official-link-top");
  const supportingFacts = app.indexOf('className="detail-supporting-facts"');
  const highlights = app.indexOf('className="detail-enrichment detail-highlights"');
  const timeline = app.indexOf('className="detail-programs detail-timeline"');
  const programs = app.indexOf('className="detail-enrichment detail-program-list"');
  const description = app.indexOf('className="detail-description detail-enrichment-summary"');
  const source = app.indexOf('className="detail-source-row"');
  assert(primaryFacts < officialCta);
  assert(officialCta < supportingFacts);
  assert(highlights < timeline && timeline < programs && programs < description);
  assert(description < source);
  assert.match(redesign, /\.detail-official-link-top\s*\{[^}]*background: #f26b38/);
  assert.match(redesign, /\.detail-timeline-item::before/);
  assert.match(redesign, /\.detail-program-card\s*\{/);
  assert.match(redesign, /\.detail-body > \.detail-enrichment-summary\s*\{\s*order: 7/);
  assert.match(redesign, /\.detail-body > \.detail-source-row\s*\{\s*order: 9/);
});

test("detail content follows the user-first hierarchy", () => {
  assert.match(app, /detail-official-link/);
  assert.match(app, /detail-event-tags/);
  assert.match(styles, /detail-body > dl \{ order: 3; \}/);
  assert.match(styles, /detail-body > \.detail-highlights \{ order: 4; \}/);
  assert.match(styles, /detail-body > \.detail-featured \{ order: 5; \}/);
  assert.match(styles, /detail-body > \.detail-program-list \{ order: 6; \}/);
  assert.match(styles, /detail-body > \.detail-official-link \{ order: 8; \}/);
  assert.match(styles, /detail-body > \.detail-source \{ order: 9; \}/);
  assert.match(styles, /detail-body > \.detail-back \{ order: 10; \}/);
  assert.doesNotMatch(app, /놓치지 마세요/);
});

test("detail uses a stable canonical path while accepting legacy query URLs", () => {
  assert.match(app, /eventIdFromPath/);
  assert.match(app, /\/events\/\$\{encodeURIComponent\(selected\)\}/);
  assert.match(app, /detailUrl\.searchParams\.get\("event"\) === selected/);
});

test("detail prefers a verified organizer or municipality enrichment page", () => {
  assert.match(app, /officialDetailSource/);
  assert.match(app, /detail\.enrichment\.source_kind/);
  assert.match(app, /detail\.enrichment\.source_priority <= 2/);
  assert.match(app, /officialDetailSource\(detail\) \?\?/);
});
