import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_SOURCE_REGISTRY,
  classifyDuplicate,
  classifyPrivateEligibility,
  classifyPrivateFacts,
  isAllowedPrivateOfficialUrl,
} from "../shared/private-official-sources";

test("eligibility separates events from products and incomplete pages", () => {
  assert.equal(
    classifyPrivateEligibility({
      title: "에버랜드 할로윈 페스티벌",
      startDate: "2026-09-01",
      endDate: "2026-11-01",
      description: "기간 한정 축제와 퍼레이드",
    }).eligibility,
    "eligible",
  );
  assert.equal(
    classifyPrivateEligibility({
      title: "에버랜드 야간권",
      startDate: null,
      endDate: null,
      description: "입장 상품",
    }).eligibility,
    "not_eligible",
  );
  assert.equal(
    classifyPrivateEligibility({
      title: "에버랜드 특별 프로그램",
      startDate: null,
      endDate: null,
      description: "운영 기간 확인 필요",
    }).eligibility,
    "needs_review",
  );
});

test("private source registry allows only confirmed Everland hosts", () => {
  assert.equal(PRIVATE_SOURCE_REGISTRY.everland.venueType, "theme_park");
  assert.equal(
    isAllowedPrivateOfficialUrl(
      "everland",
      "https://web.everland.com/pick/2026/event",
    ),
    true,
  );
  assert.equal(
    isAllowedPrivateOfficialUrl("everland", "https://evil.example/everland"),
    false,
  );
  assert.equal(
    isAllowedPrivateOfficialUrl("everland", "http://web.everland.com/event"),
    false,
  );
});

test("official fact evidence maps explicit content without venue inference", () => {
  const result = classifyPrivateFacts(
    {
      title: "에버랜드 봄 행사",
      canonicalSourceId: "/pick/2026/event#spring",
      sourceUrl: "https://web.everland.com/pick/2026/event",
      description: "테마파크에서 불꽃쇼와 공연을 진행합니다.",
    },
    "2026-09-20T00:00:00Z",
  );
  assert.deepEqual(result.candidates.map((candidate) => candidate.tag).sort(), [
    "fireworks",
    "performance",
  ]);
  const venueOnly = classifyPrivateFacts(
    {
      title: "에버랜드 시즌 안내",
      canonicalSourceId: "/pick/2026/event#season",
      sourceUrl: "https://web.everland.com/pick/2026/event",
      description: "테마파크 이용 안내입니다.",
    },
    "2026-09-20T00:00:00Z",
  );
  assert.equal(
    venueOnly.candidates.some((candidate) => candidate.tag === "fireworks"),
    false,
  );
});

test("duplicate classification stays conservative without an exact venue match", () => {
  const candidate = {
    title: "에버랜드 특별 불꽃쇼",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    venueName: "포시즌스 가든",
    address: null,
    sourceUrl: "https://web.everland.com/pick/2026/fireworks",
  } as const;
  assert.equal(classifyDuplicate(candidate, []), "new_candidate");
  assert.equal(
    classifyDuplicate(candidate, [
      {
        title: "에버랜드 특별 불꽃쇼",
        startDate: "2026-10-10",
        endDate: "2026-10-20",
        venue: "포시즌스 가든",
        address: "경기도 용인시",
      },
    ]),
    "probable_duplicate",
  );
});
