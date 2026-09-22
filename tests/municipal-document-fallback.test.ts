import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMunicipalDocumentAttachments,
  extractMunicipalDocumentCandidates,
  parseConvertedMunicipalDocument,
  type MunicipalMarkdownAI,
} from "../shared/municipal-document-fallback";
import { municipalSourceByKey } from "../shared/municipal-source-registry";
import { selectMunicipalGate } from "../shared/municipal-discovery";

test("document attachment discovery keeps only supported official-host files and prefers PDF", () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const html = [
    '<img src="/files/poster.jpg">',
    '<a href="/files/program.pdf">PDF</a>',
    '<a href="https://example.com/evil.pdf">외부</a>',
    '<a href="http://www.bucheon.go.kr/files/insecure.pdf">HTTP</a>',
  ].join("");
  const attachments = extractMunicipalDocumentAttachments(source, html);
  assert.deepEqual(
    attachments.map((item) => [item.kind, item.url]),
    [
      ["pdf", "https://www.bucheon.go.kr/files/program.pdf"],
      ["image", "https://www.bucheon.go.kr/files/poster.jpg"],
    ],
  );
});

test("explicit labeled PDF text can become a normal municipal candidate without guessing", () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const attachment = extractMunicipalDocumentAttachments(
    source,
    '<a href="/files/festa.pdf">PDF</a>',
  )[0];
  const parsed = parseConvertedMunicipalDocument(
    source,
    attachment,
    [
      "행사명: 제14회 부천가을축제",
      "행사기간: 2026. 10. 24. ~ 2026. 10. 25.",
      "장소: 중앙공원",
      "시민 공연과 체험 프로그램",
    ].join("\n"),
  );
  assert(parsed);
  assert.equal(parsed.mode, "pdf_text");
  assert.deepEqual(
    [
      parsed.candidate.title,
      parsed.candidate.start_date,
      parsed.candidate.end_date,
      parsed.candidate.venue,
      parsed.candidate.parse_error,
    ],
    ["제14회 부천가을축제", "2026-10-24", "2026-10-25", "중앙공원", undefined],
  );
  assert.equal(selectMunicipalGate(parsed.candidate).gate, "MAIN");
});

test("image conversion never auto-publishes from a single AI reading", () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const attachment = extractMunicipalDocumentAttachments(
    source,
    '<img src="/files/poster.png">',
  )[0];
  const parsed = parseConvertedMunicipalDocument(
    source,
    attachment,
    [
      "행사명: 부천 시민축제",
      "일시: 2026-10-24",
      "장소: 중앙공원",
    ].join("\n"),
  );
  assert(parsed);
  assert.equal(parsed.mode, "image_vision");
  assert.equal(
    parsed.candidate.parse_error,
    "image_vision_requires_confirmation",
  );
  assert.equal(selectMunicipalGate(parsed.candidate).gate, "REVIEW");
});

test("AI document conversion is optional and PDF extraction is bounded to explicit core", async () => {
  const source = municipalSourceByKey("bucheon");
  assert(source);
  const html = '<a href="/files/festa.pdf">PDF</a>';
  const unavailable = await extractMunicipalDocumentCandidates({
    source,
    html,
  });
  assert.equal(unavailable.status, "ai_binding_unavailable");

  const ai: MunicipalMarkdownAI = {
    async toMarkdown() {
      return {
        format: "text",
        data: [
          "축제명: 부천 문화축제",
          "기간: 2026년 10월 24일",
          "행사장: 중앙공원",
        ].join("\n"),
      };
    },
  };
  const result = await extractMunicipalDocumentCandidates({
    ai,
    source,
    html,
    fetcher: async () =>
      new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
  });
  assert.equal(result.status, "ok");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].mode, "pdf_text");
  assert.equal(result.candidates[0].candidate.start_date, "2026-10-24");
});
