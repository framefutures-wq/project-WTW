import test from "node:test";
import assert from "node:assert/strict";
import type { EventDetailEnrichment, EventItem } from "../shared/domain";
import { detailMapAction, detailOfficialUrl } from "../shared/detail-actions";

const event = (overrides: Partial<EventItem> = {}): EventItem => ({
  id: "event-1",
  title: "테스트 행사",
  description: "",
  region: "서울",
  venue: "테스트 행사장",
  address: "서울특별시 중구 테스트로 1",
  start_date: "2026-09-27",
  end_date: "2026-09-27",
  lat: 37.5665,
  lng: 126.978,
  cost: "unknown",
  price_text: null,
  pet_policy: "unknown",
  status: "scheduled",
  verification: "verified",
  is_sample: 0,
  checked_at: "2026-09-27T00:00:00Z",
  source_url: "https://www.seoul.go.kr/event",
  source_name: "서울특별시",
  source_kind: "municipality",
  trust_status: null,
  trust_checked_at: null,
  trust_source_url: null,
  trust_source_types: [],
  trust_changed_fields: [],
  tags: [],
  distance_km: null,
  ...overrides,
});

test("공식 상세 URL은 enrichment를 우선하고 지자체 primary source를 fallback으로 사용한다", () => {
  const enrichment: EventDetailEnrichment = {
    summary: "공식 소개",
    source_url: "https://festival.example.org/detail",
    source_kind: "organizer",
    source_priority: 1,
    highlights: [],
    programs: [],
  };

  assert.equal(
    detailOfficialUrl(event(), enrichment),
    "https://festival.example.org/detail",
  );

  assert.equal(
    detailOfficialUrl(event(), null),
    "https://www.seoul.go.kr/event",
  );
});

test("TourAPI primary source만으로는 공식 안내 CTA를 만들지 않는다", () => {
  assert.equal(
    detailOfficialUrl(
      event({
        source_kind: "tourapi",
        source_url: "https://apis.data.go.kr/example",
      }),
      null,
    ),
    null,
  );
});

test("신뢰 공식 source가 있으면 지자체 primary source보다 우선한다", () => {
  assert.equal(
    detailOfficialUrl(
      event({
        trust_source_url: "https://www.royalguard.kr/content/royalguard",
        trust_source_types: ["event_official"],
      }),
      null,
    ),
    "https://www.royalguard.kr/content/royalguard",
  );
});

test("검증 좌표가 있으면 카카오맵 목적지 길찾기 링크를 만든다", () => {
  assert.deepEqual(detailMapAction(event()), {
    href: "https://map.kakao.com/link/to/%ED%85%8C%EC%8A%A4%ED%8A%B8%20%ED%96%89%EC%82%AC%EC%9E%A5,37.5665,126.978",
    label: "길찾기",
  });
});

test("좌표가 없으면 확인된 주소 또는 장소를 카카오맵 검색으로 넘긴다", () => {
  assert.deepEqual(
    detailMapAction(event({ lat: null, lng: null })),
    {
      href: "https://map.kakao.com/link/search/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C%20%EC%A4%91%EA%B5%AC%20%ED%85%8C%EC%8A%A4%ED%8A%B8%EB%A1%9C%201",
      label: "지도에서 보기",
    },
  );

  assert.equal(
    detailMapAction(
      event({ lat: null, lng: null, address: "", venue: "" }),
    ),
    null,
  );
});
