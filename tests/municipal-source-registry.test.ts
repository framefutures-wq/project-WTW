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
