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
import { decideAutonomousMunicipal } from "../shared/municipal-autonomous";

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

const genericSource = (
  key: string,
  locality: string,
  url: string,
): MunicipalSourceDefinition => ({
  key,
  region: "경기",
  locality,
  url,
  allowedHosts: [new URL(url).hostname],
  healthMarkers: [],
  expectedSignals: ["html_list", "html_cards"],
  ingestion: "generic_fallback",
});

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

test("generic HTML extractor reads split start and end date columns", () => {
  const split = {
    ...source,
    genericAllowedCategories: ["공연", "전시", "축제/이벤트/행사", "체육"],
  } satisfies MunicipalSourceDefinition;
  const result = extractMunicipalCandidates(
    split,
    `공식 행사 일정
      <table><tr><th>행사명</th><th>테마</th><th>장소</th><th>시작일</th><th>종료일</th></tr>
      <tr><td><a href="/events/split?eventSeq=1&amp;menuSeq=504">가상구 공연</a></td><td>공연</td><td>가상문화회관</td><td>2026-10-24</td><td>2026-10-26</td></tr></table>`,
  );
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    result.candidates.map(
      ({ title, category, start_date, end_date, venue }) => [
        title,
        category,
        start_date,
        end_date,
        venue,
      ],
    ),
    [["가상구 공연", "공연", "2026-10-24", "2026-10-26", "가상문화회관"]],
  );
  assert.equal(
    result.candidates[0].official_url,
    "https://events.example.go.kr/events/split?eventSeq=1&menuSeq=504",
  );
});

test("generic split table applies category allowlist within each row", () => {
  const split = {
    ...source,
    genericAllowedCategories: ["공연", "전시", "축제/이벤트/행사", "체육"],
  } satisfies MunicipalSourceDefinition;
  const result = extractMunicipalCandidates(
    split,
    `공식 행사 일정
      <table><tr><th>행사명</th><th>테마</th><th>장소</th><th>시작일</th><th>종료일</th></tr>
      <tr><td><a href="/events/show">허용 공연</a></td><td>공연</td><td>공연장</td><td>2026-10-24</td><td>2026-10-24</td></tr>
      <tr><td><a href="/events/other">제외 기타</a></td><td>기타</td><td>회의실</td><td>2026-10-25</td><td>2026-10-25</td></tr></table>`,
  );
  assert.deepEqual(
    result.candidates.map(({ title, category }) => [title, category]),
    [["허용 공연", "공연"]],
  );
});

test("generic split table rejects incomplete or non-full-year dates", () => {
  const split = {
    ...source,
    genericAllowedCategories: ["공연"],
  } satisfies MunicipalSourceDefinition;
  const missingEnd = extractMunicipalCandidates(
    split,
    `공식 행사 일정<table><tr><th>행사명</th><th>테마</th><th>장소</th><th>시작일</th><th>종료일</th></tr><tr><td>누락</td><td>공연</td><td>공연장</td><td>2026-10-24</td><td></td></tr></table>`,
  );
  const inferredYear = extractMunicipalCandidates(
    split,
    `공식 행사 일정<table><tr><th>행사명</th><th>테마</th><th>장소</th><th>시작일</th><th>종료일</th></tr><tr><td>연도 없음</td><td>공연</td><td>공연장</td><td>10월 24일</td><td>10월 25일</td></tr></table>`,
  );
  assert.deepEqual(missingEnd.candidates, []);
  assert.deepEqual(inferredYear.candidates, []);
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

test("generic extractor reads the bounded Gwacheon name/info card and keeps its list URL for a JavaScript detail link", () => {
  const source = genericSource(
    "gyeonggi-과천",
    "과천",
    "https://www.gcart.or.kr/kr/concert/concertList.do",
  );
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-generic-gwacheon.html", "utf8"),
  );
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
        "2026 과천 가을 음악회",
        "2026-10-02",
        "2026-10-02",
        "대극장",
        source.url,
      ],
    ],
  );
});

test("generic extractor reads the bounded Hanam label/value card", () => {
  const source = genericSource(
    "gyeonggi-하남",
    "하남",
    "https://www.hanam.go.kr/www/selectClturEventWebList.do?key=12376",
  );
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-generic-hanam.html", "utf8"),
  );
  assert.deepEqual(
    result.candidates.map(({ title, start_date, end_date, venue }) => [
      title,
      start_date,
      end_date,
      venue,
    ]),
    [
      [
        "2026 하남 문화예술 전시",
        "2026-10-01",
        "2026-10-03",
        "하남문화예술회관 전시장",
      ],
    ],
  );
  assert.equal(
    result.candidates.some(({ venue }) => venue === "hanampen@naver.com"),
    false,
  );
});

test("generic extractor keeps Pyeongtaek physical venue and rejects a label-only venue", () => {
  const source = genericSource(
    "gyeonggi-평택",
    "평택",
    "https://www.pccf.or.kr/pfmc/pfmcAllList.do",
  );
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-generic-pyeongtaek.html", "utf8"),
  );
  assert.deepEqual(
    result.candidates.map(({ title, venue }) => [title, venue]),
    [["2026 평택 마티네 콘서트", "북부문화예술회관 소공연장"]],
  );
});

test("generic extractor skips Gyeongsan time metadata and keeps its explicit venue", () => {
  const source = genericSource(
    "gyeongbuk-경산",
    "경산",
    "https://gsctf.or.kr/user/performance/all/gal?pageNum=1",
  );
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-generic-gyeongsan.html", "utf8"),
  );
  assert.deepEqual(
    result.candidates.map(({ title, venue }) => [title, venue]),
    [["2026 경산 생활밀착형 공연", "경산청년창작소"]],
  );
});

test("generic venue validation rejects labels, contact data, URLs, dates, and times", () => {
  const invalidValues = [
    "장소",
    "venue",
    "a@example.com",
    "https://example.com/place",
    "www.example.kr",
    "02-1234-5678",
    "10:00",
    "10:00~18:00",
    "10시~18시",
    "2026-10-24",
    "10.24",
    "10월 24일",
    "기간",
    "A",
  ];
  const html = `<ul>${invalidValues
    .map(
      (venue, index) =>
        `<li><a class="title">가상구 행사 ${index}</a><span class="date">2026-10-24</span><span class="venue">${venue}</span></li>`,
    )
    .join("")}</ul>`;
  assert.deepEqual(extracted(html).candidates, []);
});

test("generic extractor reads the bounded Sangju list item and keeps its list URL for a JavaScript detail link", () => {
  const source = genericSource(
    "gyeongbuk-상주",
    "상주",
    "https://www.sangju.go.kr/life/page/10452/10182.tc",
  );
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-generic-sangju.html", "utf8"),
  );
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
        "2026 상주 가을 문화축제",
        "2026-10-10",
        "2026-10-12",
        "상주시민문화공원 일원",
        source.url,
      ],
    ],
  );
});

test("generic card fallback excludes year-less dates, missing venues, and expired cards from publication", () => {
  const cards = extracted(`
    <ul>
      <li><p class="name">연도 없는 행사</p><p class="info">10.02<br/>가상공연장</p></li>
      <li><p class="name">장소 없는 행사</p><p class="info">2026.10.02<br/>기타</p></li>
      <li><p class="name">지난 행사</p><p class="info">2026.09.01<br/>가상공연장</p></li>
    </ul>
  `);
  assert.equal(cards.candidates.length, 1);
  assert.equal(cards.candidates[0].title, "지난 행사");
  assert.equal(
    decideAutonomousMunicipal({
      gate: selectMunicipalGate(cards.candidates[0]).gate,
      duplicate: "NEW",
      temporal: "EXPIRED",
      trusted: true,
      coreValid: true,
      parserError: false,
      detailError: false,
      coreConflict: false,
    }).state,
    "EXPIRED",
  );
});

test("generic HTML extractor reads definition-list 일자 dates", () => {
  const result = extracted(`
    <ul><li><a class="title" href="/events/definition-date">가상구 공연</a>
      <dl><dt>일자</dt><dd>공연/전시 2026-12-19 ~ 2026-12-20</dd></dl>
      <span class="venue">가상문화회관</span></li></ul>
  `);
  assert.equal(result.mode, "generic_html");
  assert.deepEqual(
    [
      result.candidates[0].start_date,
      result.candidates[0].end_date,
      result.candidates[0].venue,
    ],
    ["2026-12-19", "2026-12-20", "가상문화회관"],
  );
});

test("generic HTML extractor preserves literal angle-bracket title text", () => {
  const result = extracted(`
    <ul><li><span class="institution pink">인천문화예술회관</span>
      <a class="reservation-name" href="/events/literal-title"><strong>뮤지컬</strong> &lt;광화문연가&gt;</a>
      <span class="date">2026-12-19</span><span class="venue">가상문화회관</span></li></ul>
  `);
  assert.equal(result.candidates[0].title, "뮤지컬 <광화문연가>");
  assert.equal(result.candidates[0].title.includes("<strong>"), false);
});

test("generic HTML extractor accepts a year printed once in a bounded date range", () => {
  const result = extracted(`
    <ul>
      <li><a class="title" href="/events/range-1">강남생활문화축제</a><span class="date">2026.10.17.(토)~10.18.(일) 11:00~17:00</span><span class="venue">일원에코파크 및 에코센터</span></li>
      <li><a class="title" href="/events/range-2">포천 전시</a><span class="date">2026.09.15(화)~09.21(월)</span><span class="venue">포천반월아트홀</span></li>
      <li><a class="title" href="/events/range-3">하루 확장 행사</a><span class="date">2026.10.17.(토) - 18.(일)</span><span class="venue">가상문화광장</span></li>
    </ul>
  `);
  assert.deepEqual(
    result.candidates.map(({ start_date, end_date }) => [start_date, end_date]),
    [
      ["2026-10-17", "2026-10-18"],
      ["2026-09-15", "2026-09-21"],
      ["2026-10-17", "2026-10-18"],
    ],
  );
});

test("generic HTML extractor keeps a same-day event when only its time uses a range", () => {
  const result = extracted(`
    <ul><li><a class="title" href="/events/time-range">저녁 공연</a><span class="date">2026-10-17 19:00~21:00</span><span class="venue">가상공연장</span></li></ul>
  `);
  assert.deepEqual(
    result.candidates.map(({ start_date, end_date }) => [start_date, end_date]),
    [["2026-10-17", "2026-10-17"]],
  );
});

test("generic HTML extractor does not infer a next year from a compact range tail", () => {
  const result = extracted(`
    <ul><li><a class="title" href="/events/cross-year">연말 행사</a><span class="date">2026.12.31~01.01</span><span class="venue">가상광장</span></li></ul>
  `);
  assert.equal(result.mode, "retry");
  assert.deepEqual(result.candidates, []);
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
