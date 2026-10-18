import assert from "node:assert/strict";
import test from "node:test";
import { nearbyDetailEvents, similarDetailEvents } from "../shared/detail-exploration";
import type { EventItem } from "../shared/domain";

const event = (id: string, overrides: Partial<EventItem> = {}): EventItem => ({
  id, title: id, description: "", region: "서울", venue: "광장", address: "서울 광장",
  start_date: "2026-09-23", end_date: "2026-09-25", lat: 37.5, lng: 127,
  cost: "unknown", price_text: null, pet_policy: "unknown", status: "scheduled",
  verification: "verified", is_sample: 0, checked_at: null, source_url: null,
  source_name: null, source_kind: null, trust_status: null, trust_checked_at: null,
  trust_source_url: null, trust_source_types: [], trust_changed_fields: [],
  tags: ["flowers"], distance_km: null, ...overrides,
});

test("nearby detail events exclude the current event, distances beyond 30km, and cap at three", () => {
  const result = nearbyDetailEvents([event("current", { distance_km: 0 }), event("far", { distance_km: 30.1 }), event("three", { distance_km: 3 }), event("one", { distance_km: 1 }), event("two", { distance_km: 2 }), event("four", { distance_km: 4 })], "current");
  assert.deepEqual(result.map((item) => item.id), ["one", "two", "three"]);
});

test("similar detail events retain only the requested theme and exclude the current event", () => {
  const result = similarDetailEvents([event("current"), event("flower"), event("food", { tags: ["food"] })], "current", "flowers");
  assert.deepEqual(result.map((item) => item.id), ["flower"]);
});
