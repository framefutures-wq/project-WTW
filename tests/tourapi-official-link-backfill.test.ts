import assert from "node:assert/strict";
import test from "node:test";
import {
  explicitOfficialHomepageFromStoredDetail,
  planTourApiOfficialLinkBackfill,
  validateTourApiOfficialLinkBackfill,
} from "../shared/tourapi-official-link-backfill";

const base = {
  id: "tourapi-1",
  title: "2026 테스트 축제",
  description: "방문객이 즐길 수 있는 프로그램과 공연이 열리는 공식 축제 안내입니다.",
  venue: "테스트광장",
  address: "서울 테스트구 1",
  start_date: "2026-09-27",
  end_date: "2026-10-01",
  current_publish_quality_state: "PUBLIC" as const,
  detail_source_id: "tourapi-1-detail",
};

test("stored detail backfill uses explicit event homepage first", () => {
  const raw = JSON.stringify({
    common: { homepage: '<a href="https://organizer.example/common">공식</a>' },
    intro: {
      eventhomepage:
        '<a href="https://festival.example/event/2026">행사 홈페이지</a>',
    },
  });
  assert.equal(
    explicitOfficialHomepageFromStoredDetail(raw),
    "https://festival.example/event/2026",
  );
});

test("stored detail backfill rejects provider documentation hosts and malformed payload", () => {
  assert.equal(
    explicitOfficialHomepageFromStoredDetail(
      JSON.stringify({
        intro: {
          eventhomepage:
            "https://www.data.go.kr/data/15101578/openapi.do",
        },
      }),
    ),
    null,
  );
  assert.equal(explicitOfficialHomepageFromStoredDetail("{bad"), null);
});

test("backfill can promote a sparse HOLD event when an explicit homepage exists", () => {
  const candidates = planTourApiOfficialLinkBackfill([
    {
      ...base,
      description: "한국관광공사 TourAPI에 등록된 행사입니다.",
      current_publish_quality_state: "HOLD",
      detail_raw_payload: JSON.stringify({
        common: {},
        intro: { eventhomepage: "https://festival.example/2026" },
      }),
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].previous_state, "HOLD");
  assert.equal(candidates[0].next_state, "PUBLIC");
  const validation = validateTourApiOfficialLinkBackfill(candidates);
  assert.equal(validation.ok, true);
  assert.equal(validation.promotions, 1);
});

test("backfill safety blocks any candidate that would hide a current PUBLIC event", () => {
  const validation = validateTourApiOfficialLinkBackfill([
    {
      event_id: "tourapi-2",
      source_id: "tourapi-2-detail",
      url: "https://festival.example/2",
      previous_state: "PUBLIC",
      next_state: "HOLD",
      next_reason: "insufficient_event_signal",
    },
  ]);
  assert.equal(validation.ok, false);
  assert(validation.blockers.includes("backfill_would_hide_public_event"));
});
