import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractMunicipalCandidates,
  parseGenericMunicipalHtml,
} from "../shared/municipal-discovery";
import {
  MUNICIPAL_SOURCE_REGISTRY,
  type MunicipalSourceDefinition,
} from "../shared/municipal-source-registry";

const source = {
  key: "generic-fixture",
  region: "서울",
  locality: "가상구",
  url: "https://events.example.go.kr/calendar",
  allowedHosts: ["events.example.go.kr"],
  healthMarkers: ["공식 행사 일정"],
  expectedSignals: ["html_table", "html_list", "html_cards"],
  ingestion: "generic_fallback",
} satisfies MunicipalSourceDefinition;

const extracted = (body: string) =>
  extractMunicipalCandidates(source, `공식 행사 일정${body}`);

test("generic HTML extractor reads explicit core from one table row", () => {
  const result = extracted(`
    <table><tr><th>행사명</th><th>기간</th><th>장소</th></tr>
    <tr><td><a href="/events/table">2026 가상구 가을축제</a></td><td>2026. 10. 24. ~ 2026. 10. 25.</td><td>가상문화광장</td></tr></table>
  `);
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    result.candidates.map(({ title, start_date, end_date, venue, official_url }) => [title, start_date, end_date, venue, official_url]),
    [["2026 가상구 가을축제", "2026-10-24", "2026-10-25", "가상문화광장", "https://events.example.go.kr/events/table"]],
  );
});

test("generic HTML extractor reads explicit core from a list item", () => {
  const result = extracted(`
    <ul><li><a class="title" href="/events/list">가상구 야외영화제</a><span class="date">2026-10-24</span><span class="venue">가상호수공원</span></li></ul>
  `);
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    [result.candidates[0].title, result.candidates[0].start_date, result.candidates[0].end_date, result.candidates[0].venue],
    ["가상구 야외영화제", "2026-10-24", "2026-10-24", "가상호수공원"],
  );
});

test("generic HTML extractor reads explicit core from a card block", () => {
  const result = extracted(`
    <section class="event-card"><a class="title" href="/events/card">가상구 거리축제</a><p class="period">2026년 10월 24일 ~ 2026년 10월 26일</p><p class="location">가상로 일원</p></section>
  `);
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    [result.candidates[0].title, result.candidates[0].start_date, result.candidates[0].end_date, result.candidates[0].venue],
    ["가상구 거리축제", "2026-10-24", "2026-10-26", "가상로 일원"],
  );
});

test("generic HTML extraction fails closed for missing date or venue", () => {
  const missingDate = extracted('<ul><li><a class="title" href="/events/no-date">가상구 축제</a><span class="venue">가상공원</span></li></ul>');
  const missingVenue = extracted('<ul><li><a class="title" href="/events/no-venue">가상구 축제</a><span class="date">2026-10-24</span></li></ul>');
  assert.equal(missingDate.mode, "retry");
  assert.deepEqual(missingDate.candidates, []);
  assert.equal(missingVenue.mode, "retry");
  assert.deepEqual(missingVenue.candidates, []);
});

test("generic HTML extraction never combines title, date, and venue across rows", () => {
  const result = extracted(`
    <table><tr><th>행사명</th><th>기간</th><th>장소</th></tr>
    <tr><td>가상구 축제 A</td><td>2026-10-24</td><td></td></tr>
    <tr><td>가상구 축제 B</td><td></td><td>가상광장</td></tr></table>
  `);
  assert.equal(result.mode, "retry");
  assert.deepEqual(result.candidates, []);
});

test("generic HTML extraction rejects an external detail URL", () => {
  const result = extracted(`
    <ul><li><a class="title" href="https://example.com/event">가상구 축제</a><span class="date">2026-10-24</span><span class="venue">가상공원</span></li></ul>
  `);
  assert.equal(result.mode, "retry");
  assert.deepEqual(result.candidates, []);
});

test("existing parser-backed fixtures remain on their registered parser path", () => {
  const fixtures: Record<string, string> = {
    paju: "fixtures/municipal-discovery-paju.html",
    suwon: "fixtures/municipal-discovery-suwon.html",
    goyang: "fixtures/municipal-discovery-goyang.html",
    hwaseong: "fixtures/municipal-discovery-hwaseong.html",
    bucheon: "fixtures/municipal-discovery-bucheon.html",
  };
  for (const registered of MUNICIPAL_SOURCE_REGISTRY) {
    const result = extractMunicipalCandidates(
      registered,
      readFileSync(fixtures[registered.key], "utf8"),
    );
    assert.equal(result.mode, "registered", registered.key);
    assert(result.candidates.length > 0, registered.key);
  }
});

test("direct generic parser remains empty when no self-contained core exists", () => {
  assert.deepEqual(
    parseGenericMunicipalHtml(source, '<ul><li><span class="title">가상구 축제</span></li></ul>'),
    [],
  );
});
