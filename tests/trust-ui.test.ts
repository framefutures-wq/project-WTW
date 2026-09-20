import assert from "node:assert/strict";
import test from "node:test";
import {
  cardStatusLabel,
  formatTrustDate,
  hasOfficialSource,
  officialSourceLabel,
  trustChangeLabel,
  trustDescription,
  trustTitle,
} from "../src/trust";
import type { EventItem } from "../shared/domain";

const event = (overrides: Partial<EventItem> = {}): EventItem => ({
  id: "synthetic",
  title: "합성 행사",
  description: "테스트",
  region: "서울",
  venue: "테스트 장소",
  address: "테스트 주소",
  start_date: "2026-09-19",
  end_date: "2026-09-20",
  lat: null,
  lng: null,
  cost: "unknown",
  price_text: null,
  pet_policy: "unknown",
  status: "unknown",
  verification: "verified",
  is_sample: 0,
  checked_at: null,
  source_url: null,
  source_name: null,
  source_kind: null,
  trust_status: "needs_review",
  trust_checked_at: null,
  trust_source_url: null,
  trust_source_types: [],
  trust_changed_fields: [],
  tags: [],
  distance_km: null,
  ...overrides,
});

test("trust UI uses neutral copy for needs review and no fake link or time", () => {
  const item = event();
  assert.equal(trustTitle(item.trust_status), "공식정보 확인 중");
  assert.match(trustDescription(item.trust_status), /방문 전 공식 안내/);
  assert.equal(formatTrustDate(item.trust_checked_at), null);
  assert.equal(hasOfficialSource(item), false);
});

test("confirmed UI exposes only verified source metadata", () => {
  const item = event({
    trust_status: "confirmed",
    trust_checked_at: "2026-09-19T10:00:00.000Z",
    trust_source_url: "https://official.example/event",
    trust_source_types: ["organizer_official"],
  });
  assert.equal(trustTitle(item.trust_status), "공식정보 확인");
  assert.equal(officialSourceLabel(item.trust_source_types), "주최기관 공식 안내");
  assert.equal(formatTrustDate(item.trust_checked_at), "9월 19일");
  assert.equal(hasOfficialSource(item), true);
});

test("changed fixture gets a concrete field label without exposing internal reasons", () => {
  const item = event({ trust_status: "changed", trust_changed_fields: ["venue"] });
  assert.equal(trustChangeLabel(item.trust_changed_fields), "장소 변경 확인");
  assert.equal(trustTitle(item.trust_status), "공식정보 변경 확인");
  assert.doesNotMatch(trustDescription(item.trust_status), /429|timeout|HTTP/);
});

test("cards stay quiet for normal and unconfirmed events", () => {
  assert.equal(cardStatusLabel(event()), null);
  assert.equal(
    cardStatusLabel(event({ status: "scheduled", trust_status: "confirmed" })),
    null,
  );
});

test("cards show only confirmed visit-impacting changes", () => {
  assert.equal(cardStatusLabel(event({ status: "cancelled" })), "행사 취소");
  assert.equal(cardStatusLabel(event({ status: "postponed" })), "행사 연기");
  assert.equal(
    cardStatusLabel(
      event({ trust_status: "changed", trust_changed_fields: ["start_date"] }),
    ),
    "일정 변경",
  );
  assert.equal(
    cardStatusLabel(
      event({ trust_status: "changed", trust_changed_fields: ["venue"] }),
    ),
    "장소 변경",
  );
});

test("unknown or unverified source type cannot create an official link", () => {
  const item = event({
    trust_status: "confirmed",
    trust_source_url: "https://unknown.example/event",
    trust_source_types: ["unknown"],
  });
  assert.equal(officialSourceLabel(item.trust_source_types), null);
  assert.equal(hasOfficialSource(item), false);
});
