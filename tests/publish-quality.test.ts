import assert from "node:assert/strict";
import test from "node:test";
import {
  decidePublishQuality,
  PUBLISH_QUALITY_RULE_VERSION,
} from "../shared/publish-quality";

const base = {
  title: "2026 가을 문화축제",
  description: "가을 한정으로 열리는 시민 공개 축제입니다.",
  start_date: "2026-10-01",
  end_date: "2026-10-10",
  venue: "시민광장",
  address: "서울특별시 중구",
  source_kind: "municipality",
  source_url: "https://example.go.kr/event/1",
};

test("explicit public festivals are PUBLIC", () => {
  assert.deepEqual(decidePublishQuality(base), {
    state: "PUBLIC",
    reason: "explicit_public_event",
    rule_version: PUBLISH_QUALITY_RULE_VERSION,
  });
});

test("daily operation inside a bounded special event remains PUBLIC", () => {
  assert.equal(
    decidePublishQuality({
      ...base,
      title: "가을 야간개장 특별전",
      description: "행사 기간에는 매일 운영합니다.",
      start_date: "2026-09-20",
      end_date: "2026-10-20",
    }).state,
    "PUBLIC",
  );
});

test("ordinary perpetual facilities are EXCLUDE when no special-event signal exists", () => {
  assert.deepEqual(
    decidePublishQuality({
      ...base,
      title: "푸른수목원 상시 관람",
      description: "연중 상시 운영하는 수목원 시설입니다.",
      start_date: "2026-01-01",
      end_date: "2099-12-31",
    }),
    {
      state: "EXCLUDE",
      reason: "perpetual_facility_or_program",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    },
  );
});

for (const [title, description] of [
  ["주민 대상 정규 강좌 수강생 모집", "매주 진행하는 평생학습 강좌입니다."],
  ["기관 내부 회의", "직원 대상 내부 일정입니다."],
  ["2026 정책 설명회", "정책 관련 설명회입니다."],
] as const) {
  test(`non-event content is excluded: ${title}`, () => {
    assert.deepEqual(
      decidePublishQuality({ ...base, title, description }),
      {
        state: "EXCLUDE",
        reason: "explicit_non_event",
        rule_version: PUBLISH_QUALITY_RULE_VERSION,
      },
    );
  });
}

test("missing core facts are HOLD instead of being guessed", () => {
  assert.deepEqual(
    decidePublishQuality({ ...base, venue: "", address: "" }),
    {
      state: "HOLD",
      reason: "missing_core",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    },
  );
});

test("missing or non-official source is HOLD", () => {
  assert.deepEqual(
    decidePublishQuality({ ...base, source_kind: null, source_url: null }),
    {
      state: "HOLD",
      reason: "untrusted_or_missing_official_source",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    },
  );
});

test("sparse ambiguous TourAPI records are HOLD", () => {
  assert.deepEqual(
    decidePublishQuality({
      ...base,
      title: "가을 나들이",
      description:
        "한국관광공사 TourAPI에 등록된 행사입니다. 요금·동행 조건 및 개최 여부는 출발 전 공식 공지를 확인해 주세요.",
      source_kind: "tourapi",
      source_url: "https://www.data.go.kr/data/15101578/openapi.do",
    }),
    {
      state: "HOLD",
      reason: "insufficient_event_signal",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    },
  );
});

test("bounded official event with meaningful description can be PUBLIC without keyword matching", () => {
  const decision = decidePublishQuality({
    ...base,
    title: "달빛 아래 우리 동네",
    description:
      "지역 주민과 방문객이 함께 야외 공간에서 즐기는 기간 한정 프로그램으로 현장 참여가 가능합니다.",
    start_date: "2026-10-03",
    end_date: "2026-10-04",
  });
  assert.equal(decision.state, "PUBLIC");
  assert.equal(decision.reason, "trusted_bounded_event");
});

test("long ambiguous records are HOLD even with a trusted source", () => {
  assert.deepEqual(
    decidePublishQuality({
      ...base,
      title: "문화공간 운영",
      description:
        "지역 주민과 방문객을 위해 다양한 문화 콘텐츠를 제공하는 공간 운영 안내입니다.",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    }),
    {
      state: "HOLD",
      reason: "insufficient_event_signal",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    },
  );
});
