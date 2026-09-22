import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractMunicipalCandidates,
  parseGenericMunicipalHtml,
  selectMunicipalGate,
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
    result.candidates.map(
      ({ title, start_date, end_date, venue, official_url }) => [
        title,
        start_date,
        end_date,
        venue,
        official_url,
      ],
    ),
    [
      [
        "2026 가상구 가을축제",
        "2026-10-24",
        "2026-10-25",
        "가상문화광장",
        "https://events.example.go.kr/events/table",
      ],
    ],
  );
});

test("generic HTML extractor reads explicit core from a list item", () => {
  const result = extracted(`
    <ul><li><a class="title" href="/events/list">가상구 야외영화제</a><span class="date">2026-10-24</span><span class="venue">가상호수공원</span></li></ul>
  `);
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    [
      result.candidates[0].title,
      result.candidates[0].start_date,
      result.candidates[0].end_date,
      result.candidates[0].venue,
    ],
    ["가상구 야외영화제", "2026-10-24", "2026-10-24", "가상호수공원"],
  );
});

test("generic HTML extractor reads explicit core from a card block", () => {
  const result = extracted(`
    <section class="event-card"><a class="title" href="/events/card">가상구 거리축제</a><p class="period">2026년 10월 24일 ~ 2026년 10월 26일</p><p class="location">가상로 일원</p></section>
  `);
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    [
      result.candidates[0].title,
      result.candidates[0].start_date,
      result.candidates[0].end_date,
      result.candidates[0].venue,
    ],
    ["가상구 거리축제", "2026-10-24", "2026-10-26", "가상로 일원"],
  );
});

test("generic HTML extraction fails closed for missing date or venue", () => {
  const missingDate = extracted(
    '<ul><li><a class="title" href="/events/no-date">가상구 축제</a><span class="venue">가상공원</span></li></ul>',
  );
  const missingVenue = extracted(
    '<ul><li><a class="title" href="/events/no-venue">가상구 축제</a><span class="date">2026-10-24</span></li></ul>',
  );
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
  for (const registered of MUNICIPAL_SOURCE_REGISTRY.filter(
    (source) => source.ingestion === "registered_parser",
  )) {
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
    parseGenericMunicipalHtml(
      source,
      '<ul><li><span class="title">가상구 축제</span></li></ul>',
    ),
    [],
  );
});

test("Taebaek generic calendar keeps the explicit in-block venue but excludes administrative schedules", () => {
  const taebaek = {
    key: "taebaek",
    region: "강원",
    locality: "태백",
    url: "https://www.taebaek.go.kr/www/selectWebScheduleUserList.do?key=1502",
    allowedHosts: ["taebaek.go.kr", "www.taebaek.go.kr"],
    healthMarkers: ["scheduler"],
    expectedSignals: ["html_table"],
    ingestion: "generic_fallback",
  } satisfies MunicipalSourceDefinition;
  const result = extractMunicipalCandidates(
    taebaek,
    `scheduler
    <table class="table"><tbody>
      <tr><th>행사명</th><td>2026년 3분기 태백시 통합방위협의회</td></tr>
      <tr><th>기간</th><td>2026년 09월 04일 10시 00분 ~ 2026년 09월 04일 11시 00분</td></tr>
      <tr><th>내용</th><td>○ 장 소 – 태백시청 소회의실 ○ 내 용 – 정기 회의</td></tr>
      <tr><th>장소</th><td></td></tr>
    </tbody></table>`,
  );
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    [
      result.candidates[0].start_date,
      result.candidates[0].end_date,
      result.candidates[0].venue,
    ],
    ["2026-09-04", "2026-09-04", "태백시청 소회의실"],
  );
  assert.equal(selectMunicipalGate(result.candidates[0]).gate, "EXCLUDE");
});

test("Seoul Hangang generic cards require an explicit festival, culture, or performance category", () => {
  const hangang = {
    key: "seoul-hangang",
    region: "서울",
    locality: "한강",
    url: "https://hangang.seoul.go.kr/www/eventMng/list.do?mid=538",
    allowedHosts: ["hangang.seoul.go.kr"],
    healthMarkers: ["board-list type-event"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
    genericAllowedCategories: ["축제", "문화예술", "공연"],
  } satisfies MunicipalSourceDefinition;
  const result = extractMunicipalCandidates(
    hangang,
    `board-list type-event<ul>
    <li class="list-item"><div class="event-top"><span class="cate fes">축제</span></div><a class="event-tit" href="javascript:goDetail('457')">2026 한강 종이비행기 축제</a><dl><dt>기간</dt><dd>2026-09-14(월) ~ 2026-10-10(토)</dd></dl><dl><dt>장소</dt><dd>여의도한강공원 녹음수광장</dd></dl></li>
    <li class="list-item"><div class="event-top"><span class="cate sport">체육</span></div><a class="event-tit" href="javascript:goDetail('458')">한강 체육대회</a><dl><dt>기간</dt><dd>2026-09-14 ~ 2026-10-10</dd></dl><dl><dt>장소</dt><dd>여의도한강공원</dd></dl></li>
  </ul>`,
  );
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.title,
      candidate.category,
      candidate.official_url,
    ]),
    [["2026 한강 종이비행기 축제", "축제", hangang.url]],
  );
});
