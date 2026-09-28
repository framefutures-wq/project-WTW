import assert from "node:assert/strict";
import test from "node:test";
import { convertMunicipalDocumentText, transcribeMunicipalPosterImage, type MunicipalMarkdownAI } from "../shared/municipal-document-fallback";
import { parseMunicipalPosterRichDetail, posterMatchesVerifiedEvent } from "../shared/municipal-poster-rich-detail";

const verified = {
  title: "제9회 동오마을축제 「2026 동오마을 푸드페스타」 개최",
  start_date: "2026-10-03",
  end_date: "2026-10-03",
  venue: "동오마을 공영주차장 일원(경전철 동오역 인근)",
};
const posterText = [
  "제9회 동오마을축제",
  "동오마을 푸드 페스타",
  "2026. 10. 3.(토)",
  "12:00 - 19:00",
  "동오마을 공영주차장 일원",
  "주요 프로그램 안내",
  "떡볶이 한판",
  "무대공연",
  "체험",
  "지역화폐 소비혜택",
  "랜덤 경품 이벤트",
  "주최 의정부도시공사",
].join("\n");

test("existing document conversion primitive returns normalized official poster text", async () => {
  let calls = 0;
  const ai: MunicipalMarkdownAI = {
    async toMarkdown(_file, options) {
      calls += 1;
      assert.equal(options?.conversionOptions?.image?.descriptionLanguage, "ko");
      return { format: "text", data: posterText.replace(/\n/g, "\r\n") };
    },
  };
  const text = await convertMunicipalDocumentText({
    ai,
    attachment: { url: "https://ui4u.go.kr/poster.jpg", name: "poster.jpg", kind: "image", mimeType: "image/jpeg" },
    fetcher: async () => new Response(new Uint8Array([255, 216, 255]), {
      status: 200, headers: { "content-type": "image/jpeg" },
    }),
  });
  assert.equal(text, posterText);
  assert.equal(calls, 1);
});

test("direct vision OCR requests strict JSON transcription from official poster bytes", async () => {
  let model = "";
  let input: any;
  const text = await transcribeMunicipalPosterImage({
    ai: {
      async run(requestedModel, requestedInput) {
        model = requestedModel;
        input = requestedInput;
        return { choices: [{ message: { content: JSON.stringify({ transcription: posterText }) } }] };
      },
    },
    attachment: { url: "https://ui4u.go.kr/poster.jpg", name: "poster.jpg", kind: "image", mimeType: "image/jpeg" },
    fetcher: async () => new Response(new Uint8Array([255, 216, 255]), { status: 200 }),
  });
  assert.equal(model, "@cf/google/gemma-4-26b-a4b-it");
  assert.match(input.messages[0].content, /번역.*금지/);
  assert.equal(input.response_format.type, "json_schema");
  assert.match(input.messages[1].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(text, posterText);
});

test("vision OCR rejects non-JSON image captions", async () => {
  const text = await transcribeMunicipalPosterImage({
    ai: { async run() { return { response: "A Korean festival poster." }; } },
    attachment: { url: "https://ui4u.go.kr/poster.jpg", name: "poster.jpg", kind: "image", mimeType: "image/jpeg" },
    fetcher: async () => new Response(new Uint8Array([255, 216, 255]), { status: 200 }),
  });
  assert.equal(text, null);
});

test("poster details require verified date and title or venue, with time only in hours", () => {
  assert.equal(posterMatchesVerifiedEvent(posterText, verified), true);
  assert.equal(posterMatchesVerifiedEvent(posterText.replace("2026. 10. 3.", "2026. 10. 4."), verified), false);
  assert.equal(posterMatchesVerifiedEvent("2026. 10. 3. 다른 행사 / 중앙공원", verified), false);
  assert.equal(posterMatchesVerifiedEvent("A food festival poster in Korea, October 3 2026.", verified), false);
  const detail = parseMunicipalPosterRichDetail(posterText);
  assert.equal(detail.summary, null);
  assert.deepEqual(detail.operating_hours.map(({ start_time, end_time }) => [start_time, end_time]), [["12:00", "19:00"]]);
  assert.deepEqual(detail.programs.map(({ name }) => name), [
    "떡볶이 한판", "무대공연", "체험", "지역화폐 소비혜택", "랜덤 경품 이벤트",
  ]);
});

test("poster program parser excludes OCR explanation fragments", () => {
  const detail = parseMunicipalPosterRichDetail([
    "주요 프로그램 안내",
    "음식과 떡볶이의",
    "만남",
    "무대공연",
    "무대에서 펼쳐지는",
    "댄스, 노래 등",
    "체험",
    "남녀노소 즐길 수",
  ].join("\n"));
  assert.deepEqual(detail.programs.map(({ name }) => name), ["무대공연", "체험"]);
});
