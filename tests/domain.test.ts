import { test } from "node:test";
import assert from "node:assert/strict";
import { koreaDate, dateRange, distanceKm } from "../shared/domain";
import { parseFilters, parseNearbyFilters } from "../worker/filters";
test("한국 날짜 경계와 토·일 주말 정의", () => {
  assert.equal(koreaDate(new Date("2026-09-18T15:01:00Z")), "2026-09-19");
  assert.deepEqual(dateRange("weekend", new Date("2026-09-20T02:00:00Z")), {
    start: "2026-09-19",
    end: "2026-09-20",
  });
  assert.deepEqual(
    dateRange("next-weekend", new Date("2026-09-20T02:00:00Z")),
    { start: "2026-09-26", end: "2026-09-27" },
  );
  assert.deepEqual(dateRange("weekend", new Date("2026-09-21T02:00:00Z")), {
    start: "2026-09-26",
    end: "2026-09-27",
  });
  assert.deepEqual(
    dateRange("next-weekend", new Date("2026-12-31T02:00:00Z")),
    { start: "2027-01-09", end: "2027-01-10" },
  );
});
test("잘못된 필터·좌표·페이지 입력은 거절", () => {
  for (const query of [
    "sort=distance",
    "lat=37",
    "lat=91&lng=127",
    "lat=&lng=127",
    "page=-1",
    "limit=51",
    "region=없는지역",
    "theme=hallucination",
    `q=${"가".repeat(81)}`,
  ]) {
    assert.throws(() => parseFilters(new URLSearchParams(query)), query);
  }
  assert.equal(
    parseFilters(new URLSearchParams("lat=0&lng=0&sort=distance")).lat,
    0,
  );
});
test("직선거리 계산", () => {
  assert.equal(distanceKm(37, 127, 37, 127), 0);
  assert.ok(
    Math.abs(distanceKm(37.5665, 126.978, 35.1796, 129.0756) - 325) < 5,
  );
  assert.ok(Number.isNaN(distanceKm(Number.NaN, 127, 37, 127)));
});
test("nearby POST body validates coordinates and filter contract", () => {
  assert.deepEqual(
    parseNearbyFilters({ lat: 37.567, lng: 126.978, period: "today" }).lat,
    37.567,
  );
  for (const body of [
    { lat: 37 },
    { lat: 91, lng: 127 },
    { lat: "37", lng: 127, unexpected: true },
  ])
    assert.throws(() => parseNearbyFilters(body));
});
