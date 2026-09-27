import assert from "node:assert/strict";
import test from "node:test";
import {
  auditPublishQualityRows,
  officialLinkQuality,
  type PublishQualityAuditRow,
} from "../shared/publish-quality-audit";

const base: PublishQualityAuditRow = {
  id: "event-1",
  title: "가을 축제",
  description: "시민 누구나 참여 가능한 기간 한정 축제입니다.",
  region: "서울",
  start_date: "2026-10-01",
  end_date: "2026-10-03",
  venue: "시민광장",
  address: "서울특별시 중구",
  source_kind: "municipality",
  source_name: "서울 공식 행사",
  source_url: "https://example.go.kr/event/1",
  discovered_official_url: null,
};

test("official link quality separates first-party, discovered and TourAPI-only sources", () => {
  assert.equal(officialLinkQuality(base), "FIRST_PARTY_DIRECT");
  assert.equal(
    officialLinkQuality({
      ...base,
      source_kind: "tourapi",
      source_url: "https://www.data.go.kr/data/15101578/openapi.do",
      discovered_official_url: "https://festival.example.or.kr/",
    }),
    "DISCOVERED_OFFICIAL",
  );
  assert.equal(
    officialLinkQuality({
      ...base,
      source_kind: "tourapi",
      source_url: "https://www.data.go.kr/data/15101578/openapi.do",
      discovered_official_url: null,
    }),
    "TOURAPI_ONLY",
  );
});

test("audit groups proposed state, reason, source and representative examples without mutating rows", () => {
  const rows: PublishQualityAuditRow[] = [
    base,
    {
      ...base,
      id: "hold",
      title: "가을 나들이",
      description:
        "한국관광공사 TourAPI에 등록된 행사입니다. 요금·동행 조건 및 개최 여부는 출발 전 공식 공지를 확인해 주세요.",
      source_kind: "tourapi",
      source_name: "한국관광공사 TourAPI",
      source_url: "https://www.data.go.kr/data/15101578/openapi.do",
    },
    {
      ...base,
      id: "exclude",
      title: "정규 강좌 수강생 모집",
      description: "매주 운영하는 평생학습 프로그램입니다.",
    },
  ];
  const snapshot = structuredClone(rows);
  const report = auditPublishQualityRows(rows, 1);

  assert.equal(report.total, 3);
  assert.deepEqual(report.by_state, { PUBLIC: 1, HOLD: 1, EXCLUDE: 1 });
  assert.equal(report.by_reason.explicit_public_event, 1);
  assert.equal(report.by_reason.insufficient_event_signal, 1);
  assert.equal(report.by_reason.explicit_non_event, 1);
  assert.deepEqual(report.by_source_kind.tourapi, {
    PUBLIC: 0,
    HOLD: 1,
    EXCLUDE: 0,
  });
  assert.equal(report.by_official_link_quality.FIRST_PARTY_DIRECT, 2);
  assert.equal(report.by_official_link_quality.TOURAPI_ONLY, 1);
  assert.equal(
    report.examples["HOLD:insufficient_event_signal"][0].id,
    "hold",
  );
  assert.equal(report.examples["EXCLUDE:explicit_non_event"][0].id, "exclude");
  assert.deepEqual(rows, snapshot);
});
