import assert from "node:assert/strict";
import test from "node:test";
import {
  auditPublishQualityRows,
  officialLinkQuality,
  publicQualityRisk,
  publishQualityAuditProjection,
  type PublishQualityAuditRow,
} from "../shared/publish-quality-audit";
import { decidePublishQuality } from "../shared/publish-quality";

const base: PublishQualityAuditRow = {
  id: "event-1",
  title: "가을 축제",
  description:
    "시민 누구나 참여 가능한 기간 한정 축제입니다. 공연과 체험 프로그램, 운영 안내를 공식 페이지에서 확인할 수 있습니다.",
  region: "서울",
  start_date: "2026-10-01",
  end_date: "2026-10-03",
  venue: "시민광장",
  address: "서울특별시 중구",
  source_kind: "municipality",
  source_name: "서울 공식 행사",
  source_url: "https://example.go.kr/event/1",
  discovered_official_url: null,
  current_publish_quality_state: "PUBLIC",
  current_publish_quality_reason: null,
  current_publish_quality_rule_version: null,
};

test("official link audit separates event links from source-level and TourAPI links", () => {
  assert.equal(officialLinkQuality(base), "FIRST_PARTY_SOURCE_ONLY");
  assert.equal(
    officialLinkQuality({
      ...base,
      source_kind: "tourapi",
      source_url: "https://www.data.go.kr/data/15101578/openapi.do",
      discovered_official_url: "https://festival.example.or.kr/",
    }),
    "EVENT_OFFICIAL_LINK",
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

test("public audit risk flags sparse or exact-link-poor public rows without changing publication state", () => {
  const sparse = {
    ...base,
    description: "가을 축제입니다.",
    source_kind: "public_data",
    source_url: "https://www.data.go.kr/data/15101578/openapi.do",
  };
  const decision = decidePublishQuality(sparse);
  assert.equal(decision.state, "PUBLIC");
  assert.equal(
    publicQualityRisk(sparse, decision),
    "PUBLIC_SPARSE_AND_LINK_GAP",
  );

  const healthy = {
    ...base,
    description:
      "시민 누구나 참여 가능한 기간 한정 축제입니다. 공연과 체험 프로그램, 운영시간, 현장 이용 안내가 공식 행사 페이지에 자세히 제공됩니다. 가족과 친구가 함께 방문할 수 있습니다.",
    discovered_official_url: "https://festival.example.or.kr/",
  };
  assert.equal(
    publicQualityRisk(healthy, decidePublishQuality(healthy)),
    "NONE",
  );
});

test("audit groups proposed state, source, link quality and public risk without mutating rows", () => {
  const rows: PublishQualityAuditRow[] = [
    {
      ...base,
      discovered_official_url: "https://festival.example.or.kr/",
    },
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
    {
      ...base,
      id: "sparse-public",
      title: "봄 축제",
      description: "봄 축제입니다.",
      source_kind: "public_data",
      source_name: "공공데이터 공식 행사",
      source_url: "https://www.data.go.kr/data/15101578/openapi.do",
    },
  ];
  const snapshot = structuredClone(rows);
  const report = auditPublishQualityRows(rows, 1);

  assert.equal(report.total, 4);
  assert.deepEqual(report.by_state, { PUBLIC: 2, HOLD: 1, EXCLUDE: 1 });
  assert.equal(report.by_reason.explicit_public_event, 2);
  assert.equal(report.by_reason.insufficient_event_signal, 1);
  assert.equal(report.by_reason.explicit_non_event, 1);
  assert.deepEqual(report.by_source_kind.tourapi, {
    PUBLIC: 0,
    HOLD: 1,
    EXCLUDE: 0,
  });
  assert.deepEqual(report.by_source_kind.public_data, {
    PUBLIC: 1,
    HOLD: 0,
    EXCLUDE: 0,
  });
  assert.equal(report.by_official_link_quality.EVENT_OFFICIAL_LINK, 1);
  assert.equal(report.by_official_link_quality.FIRST_PARTY_SOURCE_ONLY, 1);
  assert.equal(report.by_official_link_quality.TOURAPI_ONLY, 1);
  assert.equal(report.by_official_link_quality.MISSING, 1);
  assert.equal(report.by_public_quality_risk.PUBLIC_SPARSE_AND_LINK_GAP, 1);
  assert.deepEqual(report.rollout.current_state, { PUBLIC: 4 });
  assert.deepEqual(report.rollout.proposed_transitions, {
    "PUBLIC->PUBLIC": 2,
    "PUBLIC->HOLD": 1,
    "PUBLIC->EXCLUDE": 1,
  });
  assert.equal(report.rollout.legacy_unversioned, 4);
  assert.equal(report.rollout.proposed_visibility_changes, 2);
  assert.equal(
    report.examples["HOLD:insufficient_event_signal"][0].id,
    "hold",
  );
  assert.equal(report.examples["EXCLUDE:explicit_non_event"][0].id, "exclude");
  assert.equal(
    report.examples["RISK:PUBLIC_SPARSE_AND_LINK_GAP"][0].id,
    "sparse-public",
  );
  assert.deepEqual(rows, snapshot);
});


test("pre-migration audit treats legacy rows as grandfathered PUBLIC without referencing missing columns", () => {
  const legacy = publishQualityAuditProjection([
    "id",
    "title",
    "verification",
    "is_sample",
  ]);
  assert.equal(legacy.publishQualityColumnsPresent, false);
  assert.match(legacy.sql, /'PUBLIC' AS current_publish_quality_state/);
  assert.doesNotMatch(legacy.sql, /e\.publish_quality_state/);

  const migrated = publishQualityAuditProjection([
    "publish_quality_state",
    "publish_quality_reason",
    "publish_quality_rule_version",
    "publish_quality_checked_at",
  ]);
  assert.equal(migrated.publishQualityColumnsPresent, true);
  assert.match(migrated.sql, /e\.publish_quality_state/);
});
