import assert from "node:assert/strict";
import test from "node:test";
import { SEO_LANDINGS, seoLandingForPath } from "../shared/seo-landings";

test("weekend SEO landings cover the 17 public regions with unique paths", () => {
  assert.equal(SEO_LANDINGS.length, 17);
  assert.equal(new Set(SEO_LANDINGS.map((landing) => landing.path)).size, 17);
  assert.equal(new Set(SEO_LANDINGS.map((landing) => landing.region)).size, 17);
  assert.equal(SEO_LANDINGS.some((landing) => landing.region === "전남광주"), false);
});

test("regional weekend landing resolves discovery defaults and metadata", () => {
  assert.deepEqual(seoLandingForPath("/weekend/busan"), {
    path: "/weekend/busan",
    region: "부산",
    period: "weekend",
    title: "부산 이번 주말 행사·축제 | 갈틈",
    description:
      "부산에서 이번 주말 열리는 축제·지역행사·체험을 한눈에 확인하세요. 날짜와 장소를 공식 확인 정보와 함께 보여드립니다.",
  });
  assert.equal(seoLandingForPath("/weekend/not-a-region"), null);
});
