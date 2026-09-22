import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessMunicipalSourceDocument,
  detectMunicipalDocumentSignals,
  MUNICIPAL_SOURCE_REGISTRY,
  municipalSourceByKey,
} from "../shared/municipal-source-registry";
import { MUNICIPAL_PARSERS } from "../shared/municipal-discovery";

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
