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
  "busan-해운대": "fixtures/municipal-discovery-haeundae.html",
  "gyeongbuk-경주": "fixtures/municipal-discovery-gyeongju.html",
  "ulsan-jung": "fixtures/municipal-discovery-ulsan-jung.html",
  "gyeongbuk-포항": "fixtures/municipal-discovery-pohang.json",
  "gyeonggi-포천": "fixtures/municipal-discovery-pocheon.html",
  "gyeongnam-거제": "fixtures/municipal-discovery-geoje.html",
  "gyeongnam-산청": "fixtures/municipal-discovery-sancheong.html",
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
      "busan-해운대",
      "gyeongbuk-경주",
      "ulsan-jung",
      "gyeongbuk-포항",
      "gyeonggi-포천",
      "gyeongnam-거제",
      "jeonnam-gwangju-목포",
      "gyeongnam-산청",
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

test("Mokpo art homepage is a first-page generic source without a dedicated parser", () => {
  const source = municipalSourceByKey("jeonnam-gwangju-목포");
  assert(source);
  assert.equal(source.url, "https://www.mokpo.go.kr/art");
  assert.equal(source.ingestion, "generic_fallback");
  assert.equal(MUNICIPAL_PARSERS[source.key], undefined);
  assert.equal(source.pagination, undefined);
  assert.equal(
    municipalSourceAllowsUrl(
      source,
      "https://www.mokpo.go.kr/art/performance/new_performance?mode=view&idx=5975",
    ),
    true,
  );
  assert.equal(
    municipalSourceAllowsUrl(
      source,
      "https://biz.mokpo.go.kr/art/performance/new_performance?mode=view&idx=5975",
    ),
    true,
  );
  assert.equal(
    municipalSourceAllowsUrl(source, "https://example.com/event"),
    false,
  );
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

test("Haeundae annual parser uses the page year only for exact yearless dates", () => {
  const source = municipalSourceByKey("busan-해운대");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-haeundae.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      [
        "제39회 해운대북극곰축제",
        "2026-01-17",
        "2026-01-18",
        "해운대해수욕장 일원",
      ],
      [
        "2026 봄을 알리는 콘서트",
        "2026-03-19",
        "2026-03-19",
        "해운대문화회관 해운홀",
      ],
      [
        "톡톡톡(Talk) 실내악 페스티벌",
        "2026-03-11",
        "2026-03-13",
        "해운대문화회관 해운홀",
      ],
      [
        "제13회 해운대빛축제",
        "2026-11-29",
        "2027-01-18",
        "구남로 및 해운대해수욕장 일원",
      ],
    ],
  );
  assert(
    result.candidates.every(
      (candidate) =>
        candidate.title !== "해운대비긴어게인" &&
        candidate.title !== "2026 해운대해양레저 축제",
    ),
  );
});

test("Gyeongju parser reads official list cards with full dates and venue", () => {
  const source = municipalSourceByKey("gyeongbuk-경주");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-gyeongju.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
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
        "7746",
        "2026 한수원아트페스티벌 특별전 <한국 미술, 조선 후기부터 현대까지>",
        "2026-06-30",
        "2026-10-18",
        "경주예술의전당 알천미술관 갤러리해(4F)",
      ],
      [
        "7777",
        "경주문화관1918 환경영화제 <지구를 위해, 다시 PLAY>",
        "2026-09-05",
        "2026-09-06",
        "경주문화관1918(구 경주역)",
      ],
    ],
  );
});

test("Ulsan Jung parser carries explicit rowspan venue only within the same official table", () => {
  const source = municipalSourceByKey("ulsan-jung");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-ulsan-jung.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [
      ["에어로폰 마유희", "2026-05-09", "2026-05-09", "문화의 거리"],
      ["블루데일", "2026-05-10", "2026-05-10", "문화의 거리"],
      [
        "정글밴문화원 / 샤인롱기타",
        "2026-05-24",
        "2026-05-24",
        "문화의 거리",
      ],
    ],
  );
});

test("Pohang registered JSON source keeps bounded current candidates and first-party detail URLs", () => {
  const source = municipalSourceByKey("gyeongbuk-포항");
  assert(source);
  assert.equal(source.ingestion, "registered_parser");
  assert.deepEqual(source.pagination, { queryParam: "pageIndex", maxPages: 3 });
  const body = readFileSync("fixtures/municipal-discovery-pohang.json", "utf8");
  assert(detectMunicipalDocumentSignals(body).includes("json_payload"));
  const result = extractMunicipalCandidates(source, body);
  assert.equal(result.mode, "registered");
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.source_candidate_id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
      candidate.category,
      candidate.official_url,
    ]),
    [
      [
        "EVT_LOCAL_001",
        "포항 가을 음악회",
        "2026-10-03",
        "2026-10-03",
        "포항문화예술회관",
        "공연",
        "https://www.phcf.or.kr/phcf/performance_detail/view.do?eventId=EVT_LOCAL_001&menu_site_id=performance_detail",
      ],
      [
        "FST_LOCAL_001",
        "포항 바다축제",
        "2026-10-10",
        "2026-10-12",
        "포항 영일대해수욕장 일원",
        "축제",
        "https://www.phcf.or.kr/phcf/festival_detail/view.do?festivalId=FST_LOCAL_001",
      ],
    ],
  );
});

test("Pocheon homepage parser keeps only cards with explicit first-party core", () => {
  const source = municipalSourceByKey("gyeonggi-포천");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-pocheon.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.source_candidate_id,
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
      candidate.official_url,
    ]),
    [
      [
        "1819113",
        "시민과 함께하는 <Pride 클래식 콘서트>",
        "2026-10-10",
        "2026-10-10",
        "대극장",
        "https://www.pcfac.or.kr/sub02/sub01-1.php?type=view&uid=1819113",
      ],
      [
        "1819099",
        "<가을엔 포크 콘서트> 송창식×정미조×함춘호 밴드",
        "2026-10-16",
        "2026-10-16",
        "대극장",
        "https://www.pcfac.or.kr/sub02/sub01-1.php?type=view&uid=1819099",
      ],
      [
        "1819125",
        "가족뮤지컬 <더 스토리 오브 언더더씨>",
        "2026-10-31",
        "2026-10-31",
        "대극장",
        "https://www.pcfac.or.kr/sub02/sub01-1.php?type=view&uid=1819125",
      ],
      [
        "1819145",
        "2026년 제29회 포천 산정호수 명성산 <억새꽃축제>",
        "2026-10-16",
        "2026-10-18",
        "포천시 산정호수 명성산 일원",
        "https://www.pcfac.or.kr/sub03/sub06-1.php?type=view&uid=1819145",
      ],
    ],
  );
  assert(
    result.candidates.every(
      (candidate) => candidate.title !== "장소 미확정 문화프로그램",
    ),
  );
});

test("Geoje parser binds two-digit row years only to the explicit page year", () => {
  const source = municipalSourceByKey("gyeongnam-거제");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-geoje.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
      candidate.category,
    ]),
    [
      [
        "극단 장자번덕 가무백희악극 <토끼, 날다!>",
        "2026-08-21",
        "2026-08-22",
        "거제문화예술회관 소극장",
        "공연",
      ],
      [
        "2026 블루거제 페스티벌",
        "2026-08-01",
        "2026-08-01",
        "거제문화예술회관 야외공연장",
        "축제",
      ],
    ],
  );
});

test("Sancheong parser reads explicit full-year calendar rows without inferring dates", () => {
  const source = municipalSourceByKey("gyeongnam-산청");
  assert(source);
  const result = extractMunicipalCandidates(
    source,
    readFileSync("fixtures/municipal-discovery-sancheong.html", "utf8"),
  );
  assert.equal(result.mode, "registered");
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.title,
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
      candidate.category,
    ]),
    [
      [
        "2026 신안면청년회 벚꽃축제(블라썸피크닉)",
        "2026-04-03",
        "2026-04-04",
        "경남 산청군 신안면 하정리 813-267(원지둔치 일원)",
        "행사",
      ],
      [
        "2026 산청 농특산물 대제전",
        "2026-04-10",
        "2026-04-12",
        "경남 산청군 금서면 동의보감로555번길 45-2(동의보감촌 잔디광장)",
        "축제",
      ],
      [
        "생초국제조각공원 꽃잔디축제",
        "2026-04-10",
        "2026-04-19",
        "경남 산청군 생초면 산수로 1064(생초국제조각공원 일원)",
        "축제",
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
