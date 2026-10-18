import test from "node:test";
import assert from "node:assert/strict";
import {
  corroborateProbeImageText,
  normalizeProbePdfText,
} from "../scripts/municipal-ai-probe-evidence";
import {
  parseConvertedMunicipalDocument,
  type MunicipalDocumentAttachment,
} from "../shared/municipal-document-fallback";
import { municipalSourceByKey } from "../shared/municipal-source-registry";

const source = municipalSourceByKey("goyang");
assert(source);
const pdfAttachment: MunicipalDocumentAttachment = {
  url: "https://www.goyang.go.kr/component/file/official.pdf",
  name: "official.pdf",
  kind: "pdf",
  mimeType: "application/pdf",
};
const imageAttachment: MunicipalDocumentAttachment = {
  url: "https://www.goyang.go.kr/component/file/banner.jpg",
  name: "banner.jpg",
  kind: "image",
  mimeType: "image/jpeg",
};

test("probe reads explicit PDF fields joined by conversion without swallowing the slogan", () => {
  const converted =
    "행사 개요◯ 행사명: 2026 고양시 중장년 일자리박람회‘일자리정보에서 전문인력까지’◯ 일 시: 2026. 10. 29.(목) 14:00 ~ 17:00◯ 장 소: 고양꽃전시관◯ 주 최: 고양시";
  const pdf = parseConvertedMunicipalDocument(
    source,
    pdfAttachment,
    normalizeProbePdfText(converted),
  );
  assert(pdf);
  assert.equal(pdf.candidate.title, "2026 고양시 중장년 일자리박람회");
  assert.equal(pdf.candidate.start_date, "2026-10-29");
  assert.equal(pdf.candidate.end_date, "2026-10-29");
  assert.equal(pdf.candidate.venue, "고양꽃전시관");
  assert.equal(pdf.candidate.parse_error, undefined);

  const imageText = corroborateProbeImageText(
    'The banner reads "2026 고양시", then "중장년", then "일자리 박람회".',
    pdf,
  );
  assert(imageText);
  const image = parseConvertedMunicipalDocument(
    source,
    imageAttachment,
    imageText,
  );
  assert(image);
  assert.equal(image.candidate.start_date, "2026-10-29");
  assert.equal(image.candidate.venue, "고양꽃전시관");
  assert.equal(
    image.candidate.parse_error,
    "image_vision_requires_confirmation",
  );
});

test("probe refuses PDF core when the image title differs or PDF core is missing", () => {
  const pdf = parseConvertedMunicipalDocument(
    source,
    pdfAttachment,
    normalizeProbePdfText(
      "◯ 행사명: 2026 고양시 중장년 일자리박람회◯ 일 시: 2026. 10. 29.◯ 장 소: 고양꽃전시관",
    ),
  );
  assert(pdf);
  assert.equal(
    corroborateProbeImageText('Main Heading: "2026 다른 행사".', pdf),
    null,
  );
  assert.equal(
    corroborateProbeImageText(
      'Main Heading: "2026 고양시 중장년 일자리 박람회".',
      null,
    ),
    null,
  );
});
