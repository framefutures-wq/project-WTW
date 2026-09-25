import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessMunicipalSourceDocument,
  detectMunicipalDocumentSignals,
  MUNICIPAL_SOURCE_REGISTRY,
  municipalSourceAllowsUrl,
  municipalSourceByKey,
  type MunicipalSourceDefinition,
} from "../shared/municipal-source-registry";
import {
  extractMunicipalCandidates,
  MUNICIPAL_PARSERS,
  selectMunicipalGate,
} from "../shared/municipal-discovery";

const fixtureByKey: Record<string, string> = {
  paju: "fixtures/municipal-discovery-paju.html",
  suwon: "fixtures/municipal-discovery-suwon.html",
  goyang: "fixtures/municipal-discovery-goyang.html",
  hwaseong: "fixtures/municipal-discovery-hwaseong.html",
  bucheon: "fixtures/municipal-discovery-bucheon.html",
  "daegu-서": "fixtures/municipal-discovery-daegu-seo.html",
  "chungbuk-옥천": "fixtures/municipal-discovery-okcheon.html",
  "gyeongbuk-안동": "fixtures/municipal-discovery-andong.html",
  "busan-동": "fixtures/municipal-discovery-busan-dong.html",
  "gyeongbuk-영주": "fixtures/municipal-discovery-yeongju.html",
};

test("registry keeps existing parser-backed sources explicit", () => {
  assert.deepEqual(
    MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key),
    [
      "paju",
      "suwon",
      "goyang",
      "hwaseong",
      "bucheon",
      "taebaek",
      "seoul-hangang",
      "daejeon-fvu",
      "incheon-res",
      "gyeonggi-과천",
      "gyeonggi-하남",
      "gyeongbuk-상주",
      "gyeonggi-평택",
      "gyeonggi-여주",
      "gyeongbuk-경산",
      "incheon-서해",
      "jeonnam-gwangju-곡성",
      "gyeonggi-광주",
      "seoul-gangnam",
      "ulsan-북",
      "daegu-서",
      "gangwon-원주",
      "gyeonggi-용인",
      "gyeonggi-이천",
      "gyeonggi-의정부",
      "chungbuk-옥천",
      "gyeongbuk-안동",
      "busan-동",
      "gyeongbuk-영주",
    ],
  );
  for (const source of MUNICIPAL_SOURCE_REGISTRY.filter(
    (source) => source.ingestion === "registered_parser",
  )) {
    assert.equal(source.ingestion, "registered_parser");
    assert.equal(typeof MUNICIPAL_PARSERS[source.key], "function");
    assert.equal(new URL(source.url).protocol, "https:");
    assert(source.allowedHosts.includes(new URL(source.url).hostname));
  }
  assert(
    MUNICIPAL_SOURCE_REGISTRY.every((source) => !source.listDetailFollowup),
  );
});

test("Daejeon FVU is a generic table source without a dedicated parser", () => {
  const source = municipalSourceByKey("daejeon-fvu");
  assert(source);
  assert.equal(source.ingestion, "generic_fallback");
  assert.equal(MUNICIPAL_PARSERS[source.key], undefined);
  assert.deepEqual(source.genericAllowedCategories, [
    "공연",
    "전시",
    "축제/이벤트/행사",
    "체육",
  ]);
  assert.equal(
    municipalSourceAllowsUrl(
      source,
      "https://daejeon.go.kr/fvu/FvuEventView.do?eventSeq=1",
    ),
    true,
  );
  assert.equal(
    municipalSourceAllowsUrl(source, "https://example.com/event"),
    false,
  );
});

test("Incheon reservation is a bounded generic source without a dedicated parser", () => {
  const source = municipalSourceByKey("incheon-res");
  assert(source);
  assert.equal(source.ingestion, "generic_fallback");
  assert.equal(MUNICIPAL_PARSERS[source.key], undefined);
  assert.deepEqual(source.pagination, { queryParam: "curPage", maxPages: 3 });
  assert.equal(
    municipalSourceAllowsUrl(
      source,
      "https://www.incheon.go.kr/res/RE050101/pblprfrDspyView?progrmSn=1",
    ),
    true,
  );
  assert.equal(
    municipalSourceAllowsUrl(source, "https://example.com/event"),
    false,
  );
});

test("Gwacheon, Hanam, and Sangju use bounded generic registry settings", () => {
  const expected = [
    ["gyeonggi-과천", "pageIndex", 2],
    ["gyeonggi-하남", "pageIndex", 3],
    ["gyeongbuk-상주", "pageIndex", 2],
  ] as const;
  for (const [key, queryParam, maxPages] of expected) {
    const source = municipalSourceByKey(key);
    assert(source, key);
    assert.equal(source.ingestion, "generic_fallback", key);
    assert.equal(MUNICIPAL_PARSERS[source.key], undefined, key);
    assert.deepEqual(source.pagination, { queryParam, maxPages }, key);
    assert.equal(municipalSourceAllowsUrl(source, source.url), true, key);
    assert.equal(
      municipalSourceAllowsUrl(source, "https://example.com/event"),
      false,
      key,
    );
  }
});

test("Pyeongtaek, Yeoju, and Gyeongsan are bounded generic sources without dedicated parsers", () => {
  const expected = [
    ["gyeonggi-평택", "https://www.pccf.or.kr/pfmc/pfmcAllList.do"],
    ["gyeonggi-여주", "https://www.yjcf.or.kr/reserve/board/1/M/L/menu/401"],
    ["gyeongbuk-경산", "https://gsctf.or.kr/user/performance/all/gal?pageNum=1"],
  ] as const;
  for (const [key, url] of expected) {
    const source = municipalSourceByKey(key);
    assert(source, key);
    assert.equal(source.url, url, key);
    assert.equal(source.ingestion, "generic_fallback", key);
    assert.equal(MUNICIPAL_PARSERS[source.key], undefined, key);
    assert.equal(municipalSourceAllowsUrl(source, source.url), true, key);
    assert.equal(
      municipalSourceAllowsUrl(source, "https://example.com/event"),
      false,
      key,
    );
  }
  assert.deepEqual(municipalSourceByKey("gyeongbuk-경산")?.pagination, {
    queryParam: "pageNum",
    maxPages: 3,
  });
});


test("Seohae and Gokseong are bounded generic sources without dedicated parsers", () => {
  const expected = [
    [
      "incheon-서해",
      "https://www.seohae.go.kr/open_content/culture/cultureListAll.do",
      "pgno",
    ],
    [
      "jeonnam-gwangju-곡성",
      "https://www.gokseong.go.kr/tour/festivity/event",
      "page",
    ],
  ] as const;
  for (const [key, url, queryParam] of expected) {
    const source = municipalSourceByKey(key);
    assert(source, key);
    assert.equal(source.url, url, key);
    assert.equal(source.ingestion, "generic_fallback", key);
    assert.equal(MUNICIPAL_PARSERS[source.key], undefined, key);
    assert.deepEqual(source.pagination, { queryParam, maxPages: 3 }, key);
    assert.equal(municipalSourceAllowsUrl(source, source.url), true, key);
    assert.equal(
      municipalSourceAllowsUrl(source, "https://example.com/event"),
      false,
      key,
    );
  }
});

test("Gyeonggi Gwangju uses the current first-page generic source without guessing pagination", () => {
  const source = municipalSourceByKey("gyeonggi-광주");
  assert(source);
  assert.equal(
    source.url,
    "https://www.gjcity.go.kr/portal/bbs/list.do?mId=0201030100&ptIdx=24",
  );
  assert.equal(source.ingestion, "generic_fallback");
  assert.equal(MUNICIPAL_PARSERS[source.key], undefined);
  assert.equal(source.pagination, undefined);
  assert.equal(municipalSourceAllowsUrl(source, source.url), true);
  assert.equal(
    municipalSourceAllowsUrl(source, "https://example.com/event"),
    false,
  );
});

test("Gangnam and Ulsan Buk-gu use first-page generic sources without guessed pagination", () => {
  const expected = [
    [
      "seoul-gangnam",
      "https://www.gangnam.go.kr/office/gfac/board/gfac_lifeculture/list.do?mid=gfac_festival06",
    ],
    ["ulsan-북", "https://www.bukgu.ulsan.kr/art/BBS_014List.mo"],
  ] as const;
  for (const [key, url] of expected) {
    const source = municipalSourceByKey(key);
    assert(source, key);
    assert.equal(source.url, url, key);
    assert.equal(source.ingestion, "generic_fallback", key);
    assert.equal(MUNICIPAL_PARSERS[source.key], undefined, key);
    assert.equal(source.pagination, undefined, key);
    assert.equal(municipalSourceAllowsUrl(source, source.url), true, key);
    assert.equal(
      municipalSourceAllowsUrl(source, "https://example.com/event"),
      false,
      key,
    );
  }
});

test("Pyeongtaek and Gyeongsan registry contracts parse their retained live-shape fixtures", () => {
  const fixtureByGenericKey = {
    "gyeonggi-평택": "fixtures/municipal-generic-pyeongtaek.html",
    "gyeongbuk-경산": "fixtures/municipal-generic-gyeongsan.html",
  } as const;
  for (const [key, fixture] of Object.entries(fixtureByGenericKey)) {
    const source = municipalSourceByKey(key);
    assert(source, key);
    const html = readFileSync(fixture, "utf8");
    const assessment = assessMunicipalSourceDocument(source, html);
    assert.equal(
      assessment.status,
      "healthy",
      `${key}: ${assessment.reason}`,
    );
    const extracted = extractMunicipalCandidates(source, html);
    assert.equal(extracted.mode, "generic_html", key);
    assert(extracted.candidates.length > 0, key);
  }
});

test("Wonju generic table source parses complete rows and rejects rows without a venue", () => {
  const source = municipalSourceByKey("gangwon-원주");
  assert(source);
  assert.equal(source.ingestion, "generic_fallback");
  const html = readFileSync("fixtures/municipal-generic-wonju.html", "utf8");
  const assessment = assessMunicipalSourceDocument(source, html);
  assert.equal(assessment.status, "healthy");
  const extraction = extractMunicipalCandidates(source, html);
  assert.equal(extraction.mode, "generic_html");
  assert.equal(extraction.candidates.length, 1);
  assert.deepEqual(
    [
      extraction.candidates[0].title,
      extraction.candidates[0].start_date,
      extraction.candidates[0].end_date,
      extraction.candidates[0].venue,
    ],
    [
      "백건우 & 슈베르트",
      "2026-09-03",
      "2026-09-03",
      "원주백운아트홀",
    ],
  );
});

test("Yongin and Icheon use bounded generic source contracts", () => {
  const yongin = municipalSourceByKey("gyeonggi-용인");
  assert(yongin);
  assert.equal(yongin.ingestion, "generic_fallback");
  assert.equal(MUNICIPAL_PARSERS[yongin.key], undefined);
  assert.deepEqual(yongin.pagination, { queryParam: "page", maxPages: 3 });
  assert.equal(municipalSourceAllowsUrl(yongin, yongin.url), true);

  const icheon = municipalSourceByKey("gyeonggi-이천");
  assert(icheon);
  assert.equal(icheon.ingestion, "generic_fallback");
  assert.equal(MUNICIPAL_PARSERS[icheon.key], undefined);
  assert.equal(icheon.pagination, undefined);
  assert.equal(municipalSourceAllowsUrl(icheon, icheon.url), true);

  for (const source of [yongin, icheon]) {
    assert.equal(
      municipalSourceAllowsUrl(source, "https://example.com/event"),
      false,
      source.key,
    );
  }
});

test("Uijeongbu official annual event table parses explicit split dates and venue", () => {
  const source = municipalSourceByKey("gyeonggi-의정부");
  assert(source);
  const html = readFileSync("fixtures/municipal-generic-uijeongbu.html", "utf8");
  const assessment = assessMunicipalSourceDocument(source, html);
  assert.equal(assessment.status, "healthy");
  const extraction = extractMunicipalCandidates(source, html);
  assert.equal(extraction.mode, "generic_html");
  assert.equal(extraction.candidates.length, 2);
  assert.deepEqual(
    extraction.candidates.map((candidate) => [
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      [
        "송3 어울림 한마당 축제",
        "2026-10-17",
        "2026-10-17",
        "민락2지구 로데오 거리 일대",
      ],
      [
        "제9회 동오마을축제 「2026 동오마을 푸드페스타」 개최",
        "2026-10-03",
        "2026-10-03",
        "동오마을 공영주차장 일원(경전철 동오역 인근)",
      ],
    ],
  );
});

test("Okcheon parser keeps the explicit venue instead of mistaking the title for venue", () => {
  const source = municipalSourceByKey("chungbuk-옥천");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-okcheon.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      [
        "옥천묘목축제",
        "2026-04-02",
        "2026-04-05",
        "옥천묘목공원 （옥천군 이원면 이원리 503번지 일원）",
      ],
      [
        "청산생선국수 축제",
        "2026-04-11",
        "2026-04-12",
        "청산체육공원",
      ],
    ],
  );
});

test("Andong parser reads the official repeated culture cards", () => {
  const source = municipalSourceByKey("gyeongbuk-안동");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-andong.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.source_candidate_id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      [
        "CENT0000001237",
        "문화놀이터 - 휴앤아트",
        "2026-11-07",
        "2026-11-07",
        "옥동제4공원",
      ],
      [
        "CENT0000001238",
        "안동 가을 문화마당",
        "2026-10-10",
        "2026-10-11",
        "안동문화예술의전당",
      ],
    ],
  );
});

test("Busan Dong-gu parser reads nested gallery cards without mixing child list items", () => {
  const source = municipalSourceByKey("busan-동");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-busan-dong.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.source_candidate_id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      [
        "5097323",
        "유규영 작가 초대전 <<엄마의 식탁>>",
        "2026-10-01",
        "2026-12-31",
        "유치환의 우체통 아트갤러리",
      ],
      [
        "5091365",
        "《재수의 연습장 : 재수 좋은 날》",
        "2026-06-20",
        "2026-10-25",
        "동구 문화플랫폼 시민마당 전시장",
      ],
    ],
  );
});

test("Yeongju parser deduplicates repeated calendar-day appearances by mon_uid", () => {
  const source = municipalSourceByKey("gyeongbuk-영주");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-yeongju.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.source_candidate_id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      [
        "388",
        "청소년 페스티벌",
        "2026-09-05",
        "2026-09-05",
        "영주시문화예술회관 까치홀(가흥로 257)",
      ],
      [
        "401",
        "8090 락페스티벌",
        "2026-09-12",
        "2026-09-12",
        "영주 중앙시장 상설무대",
      ],
    ],
  );
});

test("generic registry sources enter JSON-LD fallback without a dedicated parser", () => {
  const source = {
    key: "generic-fixture",
    region: "경기",
    locality: "가상시",
    url: "https://events.example.go.kr/calendar",
    allowedHosts: ["events.example.go.kr"],
    healthMarkers: ["공식 행사 일정"],
    expectedSignals: ["structured_event", "pdf_attachment", "image_attachment"],
    ingestion: "generic_fallback",
  } satisfies MunicipalSourceDefinition;
  const html = `
    공식 행사 일정
    <script type="application/ld+json">
      {"@type":"Event","@id":"https://events.example.go.kr/events/2026-festival","name":"2026 가상시 가을축제","startDate":"2026-10-24","endDate":"2026-10-25","location":{"name":"가상공원"}}
    </script>
  `;
  const assessment = assessMunicipalSourceDocument(source, html);
  assert.equal(assessment.status, "healthy");
  assert.equal(assessment.reason, "generic_fallback_contract_present");
  assert.equal(MUNICIPAL_PARSERS[source.key], undefined);
  const extracted = extractMunicipalCandidates(source, html);
  assert.equal(extracted.mode, "structured_event");
  assert.equal(extracted.candidates.length, 1);
  assert.deepEqual(
    [
      extracted.candidates[0].source,
      extracted.candidates[0].start_date,
      extracted.candidates[0].end_date,
      extracted.candidates[0].venue,
    ],
    ["generic-fixture", "2026-10-24", "2026-10-25", "가상공원"],
  );
});

test("current municipal fixtures satisfy their registered parser contracts", () => {
  for (const source of MUNICIPAL_SOURCE_REGISTRY.filter(
    (source) => source.ingestion === "registered_parser",
  )) {
    const html = readFileSync(fixtureByKey[source.key], "utf8");
    const assessment = assessMunicipalSourceDocument(source, html);
    assert.equal(
      assessment.status,
      "healthy",
      `${source.key}: ${assessment.reason}`,
    );
    const parser = MUNICIPAL_PARSERS[source.key];
    assert(parser);
    assert(parser(html).length > 0);
  }
});

test("Daegu Seo registered parser reads the official embedded monthly schedule payload", () => {
  const source = municipalSourceByKey("daegu-서");
  assert(source);
  assert.equal(source.ingestion, "registered_parser");
  assert.equal(typeof MUNICIPAL_PARSERS[source.key], "function");
  const html = readFileSync(
    "fixtures/municipal-discovery-daegu-seo.html",
    "utf8",
  );
  const extraction = extractMunicipalCandidates(source, html);
  assert.equal(extraction.mode, "registered");
  assert.equal(extraction.candidates.length, 2);
  assert.deepEqual(
    extraction.candidates.map((candidate) => [
      candidate.source_candidate_id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      [
        "340",
        "My Favorite Songs",
        "2026-04-04",
        "2026-04-04",
        "비원뮤직홀 공연장",
      ],
      [
        "367",
        "[대관]CINEMA IN CLASSIC",
        "2026-04-11",
        "2026-04-11",
        "비원뮤직홀 공연",
      ],
    ],
  );
});

test("format changes fail closed while exposing fallback document signals", () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const posterOnly =
    '<html><body><a href="/files/autumn.pdf">행사안내</a><img src="/poster.jpg" alt="축제 포스터"></body></html>';
  const assessment = assessMunicipalSourceDocument(source, posterOnly);
  assert.equal(assessment.status, "format_changed");
  assert(assessment.observedSignals.includes("pdf_attachment"));
  assert(assessment.observedSignals.includes("image_attachment"));
});

test("document signal detection recognizes structured event data without treating it as verified core", () => {
  const signals = detectMunicipalDocumentSignals(
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"행사"}</script>',
  );
  assert(signals.includes("structured_event"));
});

test("registered detail URLs are restricted to explicit official hosts", () => {
  const paju = municipalSourceByKey("paju");
  assert(paju);
  assert.equal(
    municipalSourceAllowsUrl(
      paju,
      "https://tour.paju.go.kr/user/link/cultural/detail.do?id=1",
    ),
    true,
  );
  assert.equal(
    municipalSourceAllowsUrl(paju, "https://example.com/festival"),
    false,
  );
  assert.equal(
    municipalSourceAllowsUrl(paju, "http://tour.paju.go.kr/insecure"),
    false,
  );
});

test("format-changed source can fall back to explicit official JSON-LD Event core", () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const html = `
    <html><head>
      <script type="application/ld+json">
        {
          "@context":"https://schema.org",
          "@type":"Event",
          "@id":"https://www.bucheon.go.kr/events/autumn-2026",
          "name":"2026 부천 가을축제",
          "startDate":"2026-10-24T13:00:00+09:00",
          "endDate":"2026-10-24T16:00:00+09:00",
          "location":{"@type":"Place","name":"중앙공원"},
          "description":"시민 공연과 체험 프로그램"
        }
      </script>
    </head></html>
  `;
  const extracted = extractMunicipalCandidates(source, html);
  assert.equal(extracted.mode, "structured_event");
  assert.equal(extracted.candidates.length, 1);
  const event = extracted.candidates[0];
  assert.equal(event.title, "2026 부천 가을축제");
  assert.deepEqual(
    [event.start_date, event.end_date, event.venue],
    ["2026-10-24", "2026-10-24", "중앙공원"],
  );
  assert.equal(
    event.official_url,
    "https://www.bucheon.go.kr/events/autumn-2026",
  );
  assert.equal(selectMunicipalGate(event).gate, "MAIN");
});

test("structured fallback stays retry-only when explicit core is incomplete", () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const html =
    '<script type="application/ld+json">{"@type":"Event","name":"부천 축제","startDate":"2026-10-24"}</script>';
  const extracted = extractMunicipalCandidates(source, html);
  assert.equal(extracted.mode, "structured_event");
  assert.equal(
    extracted.candidates[0].parse_error,
    "structured_event_missing_core",
  );
  assert.equal(selectMunicipalGate(extracted.candidates[0]).gate, "REVIEW");
});

test("PDF or poster-only format changes remain fail-closed for later verified extractors", () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const html =
    '<a href="/files/festa.pdf">행사 안내</a><img src="/poster.jpg" alt="행사 포스터">';
  const extracted = extractMunicipalCandidates(source, html);
  assert.equal(extracted.mode, "retry");
  assert.deepEqual(extracted.candidates, []);
});
