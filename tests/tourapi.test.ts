import { test } from "node:test";
import assert from "node:assert/strict";
import {
  date,
  mapFestival,
  parseTourResponse,
  regionName,
  selectFestivalSnapshot,
  rejectionReasons,
  TourApiSnapshotError,
} from "../worker/sources/tourapi";

// Synthetic contract fixtures. These are never loaded into the application's database.
const row = {
  contentid: "100",
  contenttypeid: "15",
  title: "계약 테스트 행사",
  addr1: "테스트 주소",
  lDongRegnCd: "11",
  eventstartdate: "20260901",
  eventenddate: "20261101",
  mapx: "127",
  mapy: "37",
  progresstype: "선택안함",
};
const regions = new Map([["11", "서울"]]);
const now = "2026-09-18T00:00:00.000Z";
test("TourAPI dates reject impossible dates and ambiguous formats", () => {
  assert.equal(date("20260229"), null);
  assert.equal(date("20240229"), "2024-02-29");
  assert.equal(date("20261301"), null);
  assert.equal(date("2026-09-18"), null);
});

test("rejected items retain raw fields and all reasons, including failed snapshots", () => {
  const bad = {
    ...row,
    contentid: "bad",
    title: "",
    addr1: "",
    eventstartdate: "20260229",
    eventenddate: "",
    progresstype: "unknown",
  };
  assert.deepEqual(rejectionReasons(bad, regions), [
    "INVALID_CONTENT_ID",
    "MISSING_TITLE",
    "MISSING_ADDRESS",
    "INVALID_START_DATE",
    "INVALID_END_DATE",
    "UNSUPPORTED_PROGRESS_TYPE",
  ]);
  const snapshot = selectFestivalSnapshot([row, bad], regions, new Date(now));
  assert.equal(snapshot.rejected, 1);
  assert.deepEqual(snapshot.rejections[0].raw, bad);
  assert.deepEqual(
    snapshot.rejections[0].reasons,
    rejectionReasons(bad, regions),
  );
  assert.throws(
    () => selectFestivalSnapshot([bad], regions, new Date(now)),
    (error: unknown) =>
      error instanceof TourApiSnapshotError && error.rejections[0].raw === bad,
  );
  assert.throws(
    () => selectFestivalSnapshot([row, row], regions, new Date(now)),
    (error: unknown) =>
      error instanceof TourApiSnapshotError &&
      error.rejections.some((r) => r.reasons.includes("DUPLICATE_CONTENT_ID")),
  );
  assert.deepEqual(
    rejectionReasons({ ...row, eventenddate: "20250801" }, regions),
    ["START_AFTER_END"],
  );
});
test("TourAPI does not guess status, price, pet policy or audience from titles", () => {
  const event = mapFestival(
    { ...row, title: "무료 반려동물 커플 꽃 축제" },
    regions,
    now,
  )!;
  assert.equal(event.status, "unknown");
  assert.equal(event.cost, "unknown");
  assert.equal(event.price_text, null);
  assert.equal(event.pet_policy, "unknown");
  assert.equal(event.venue, row.addr1);
  assert.equal(event.lat, 37);
  assert.equal(event.lng, 127);
  assert.equal(
    mapFestival({ ...row, progresstype: "취소" }, regions, now)!.status,
    "cancelled",
  );
  assert.equal(
    mapFestival({ ...row, progresstype: "행사연기" }, regions, now)!.status,
    "postponed",
  );
  assert.equal(
    mapFestival({ ...row, progresstype: "미문서화 코드" }, regions, now),
    null,
  );
});
test("TourAPI rejects incomplete records and invalid coordinate pairs", () => {
  for (const change of [
    { eventenddate: "" },
    { title: "" },
    { addr1: "" },
    { lDongRegnCd: "999" },
    { contenttypeid: "12" },
    { eventenddate: "20250801" },
  ])
    assert.equal(mapFestival({ ...row, ...change }, regions, now), null);
  for (const change of [
    { mapx: "" },
    { mapy: "91" },
    { mapx: "0", mapy: "0" },
    { mapx: "NaN" },
  ]) {
    const event = mapFestival({ ...row, ...change }, regions, now)!;
    assert.equal(event.lat, null);
    assert.equal(event.lng, null);
  }
});
test("TourAPI response parser validates provider errors, singleton and empty payloads", () => {
  const response = (
    items: unknown,
    totalCount: unknown = 1,
    resultCode = "0000",
  ) => ({ response: { header: { resultCode }, body: { items, totalCount } } });
  assert.deepEqual(parseTourResponse(response({ item: row })).items, [row]);
  assert.deepEqual(parseTourResponse(response({ item: [row] })).items, [row]);
  assert.deepEqual(parseTourResponse(response("", 0)).items, []);
  assert.throws(() => parseTourResponse(response("", 1)));
  assert.throws(() => parseTourResponse(response({ item: row }, 1, "30")));
  assert.throws(() => parseTourResponse(response({ item: row }, -1)));
  assert.equal(regionName("강원특별자치도"), "강원");
  assert.equal(regionName("전북특별자치도"), "전북");
  assert.equal(regionName("알 수 없는 지역"), null);
});

test("30-day window includes ongoing festivals, both boundary days, and excludes ended/outside events", () => {
  const fixture = (id: string, start: string, end: string) => ({
    ...row,
    contentid: id,
    eventstartdate: start,
    eventenddate: end,
  });
  const snapshot = selectFestivalSnapshot(
    [
      fixture("1", "20250101", "20270101"),
      fixture("2", "20260901", "20260918"),
      fixture("3", "20261018", "20261020"),
      fixture("4", "20260901", "20260917"),
      fixture("5", "20261019", "20261020"),
    ],
    regions,
    new Date(now),
  );
  assert.deepEqual(
    snapshot.candidates.map((c) => c.event.id),
    ["tourapi-1", "tourapi-2", "tourapi-3"],
  );
  assert.equal(snapshot.until, "2026-10-18");
  assert.throws(() => selectFestivalSnapshot([], regions, new Date(now)));
  assert.throws(() =>
    selectFestivalSnapshot([row, row], regions, new Date(now)),
  );
});
