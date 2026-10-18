import assert from "node:assert/strict";
import test from "node:test";
import { pageMentionsEventTitle, selectOtherHttpsCandidates, titleTokens } from "../shared/tourapi-other-https-evidence";

test("filters assets, provider URLs, and homepage fields from other HTTPS candidates", () => {
  const result = selectOtherHttpsCandidates([
    {
      url: "https://tong.visitkorea.or.kr/photo.jpg",
      path: "base.firstimage",
      asset: true,
    },
    {
      url: "https://www.data.go.kr/data/15101578/openapi.do",
      path: "base.provider",
      asset: false,
    },
    {
      url: "https://festival.example.org/event/2026",
      path: "detail.common.homepage",
      asset: false,
    },
    {
      url: "https://festival.example.org/news/2026",
      path: "detail.info.0.infotext",
      asset: false,
    },
  ]);
  assert.deepEqual(result, [
    {
      url: "https://festival.example.org/news/2026",
      path: "detail.info.0.infotext",
      host: "festival.example.org",
      category: "GENERAL_WEB",
    },
  ]);
});

test("categorizes social and ticket URLs without declaring them official", () => {
  const result = selectOtherHttpsCandidates([
    {
      url: "https://www.instagram.com/examplefestival/",
      path: "detail.info.0.infotext",
      asset: false,
    },
    {
      url: "https://booking.naver.com/booking/12/bizes/34",
      path: "detail.info.1.infotext",
      asset: false,
    },
  ]);
  assert.deepEqual(
    result.map((item) => item.category),
    ["SOCIAL", "TICKETING"],
  );
});

test("title signal requires meaningful event-title token overlap", () => {
  assert.deepEqual(titleTokens("2026 울산야외도서관 소풍"), ["울산야외도서관", "소풍"]);
  assert.equal(
    pageMentionsEventTitle({
      title: "2026 울산야외도서관 소풍",
      pageTitle: "울산야외도서관 소풍 | 울산광역시",
      pageText: "울산야외도서관 소풍 행사 안내",
    }),
    true,
  );
  assert.equal(
    pageMentionsEventTitle({
      title: "2026 울산야외도서관 소풍",
      pageTitle: "울산 관광",
      pageText: "다양한 행사와 관광지를 소개합니다.",
    }),
    false,
  );
});