import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessMunicipalSourceDocument,
  detectMunicipalDocumentSignals,
  MUNICIPAL_SOURCE_REGISTRY,
  municipalSourceAllowsUrl,
  municipalSourceByKey,
} from "../shared/municipal-source-registry";
import {
  extractMunicipalCandidates,
  MUNICIPAL_PARSERS,
  selectMunicipalGate,
} from "../shared/municipal-discovery";

const fixtureByKey = {
  paju: "fixtures/municipal-discovery-paju.html",
  suwon: "fixtures/municipal-discovery-suwon.html",
  goyang: "fixtures/municipal-discovery-goyang.html",
  hwaseong: "fixtures/municipal-discovery-hwaseong.html",
  bucheon: "fixtures/municipal-discovery-bucheon.html",
} as const;

test("registry is the single source list and every registered source has a parser", () => {
  assert.deepEqual(
    MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key),
    ["paju", "suwon", "goyang", "hwaseong", "bucheon"],
  );
  for (const source of MUNICIPAL_SOURCE_REGISTRY) {
    assert.equal(typeof MUNICIPAL_PARSERS[source.key], "function");
    assert.equal(new URL(source.url).protocol, "https:");
    assert(source.allowedHosts.includes(new URL(source.url).hostname));
  }
});

test("current municipal fixtures satisfy their registered parser contracts", () => {
  for (const source of MUNICIPAL_SOURCE_REGISTRY) {
    const html = readFileSync(fixtureByKey[source.key], "utf8");
    const assessment = assessMunicipalSourceDocument(source, html);
    assert.equal(
      assessment.status,
      "healthy",
      `${source.key}: ${assessment.reason}`,
    );
    assert(MUNICIPAL_PARSERS[source.key](html).length > 0);
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
