import assert from "node:assert/strict";
import test from "node:test";
import { dateRange, validDate } from "../shared/domain";
import { InputError, parseFilters } from "../worker/filters";

test("custom day selection parses as a one-day range", () => {
  const filters = parseFilters(
    new URLSearchParams("period=custom&date=2026-09-27&region=경기&cost=free"),
  );
  assert.deepEqual(filters.customRange, {
    start: "2026-09-27",
    end: "2026-09-27",
  });
  assert.equal(filters.region, "경기");
  assert.equal(filters.cost, "free");
});

test("custom period selection supports overlap semantics", () => {
  const filters = parseFilters(
    new URLSearchParams("period=custom&startDate=2026-09-25&endDate=2026-09-27"),
  );
  assert.deepEqual(filters.customRange, {
    start: "2026-09-25",
    end: "2026-09-27",
  });
  const overlaps = (start: string, end: string) =>
    start <= filters.customRange!.end && end >= filters.customRange!.start;
  assert.equal(overlaps("2026-09-27", "2026-09-29"), true);
  assert.equal(overlaps("2026-09-28", "2026-09-29"), false);
});

test("date validation rejects malformed and reversed ranges", () => {
  assert.equal(validDate("2026-09-27"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.throws(
    () => parseFilters(new URLSearchParams("period=custom&date=2026-09-31")),
    InputError,
  );
  assert.throws(
    () =>
      parseFilters(
        new URLSearchParams("period=custom&startDate=2026-09-28&endDate=2026-09-27"),
      ),
    InputError,
  );
  assert.throws(
    () => parseFilters(new URLSearchParams("period=weekend&date=2026-09-27")),
    InputError,
  );
});

test("preset ranges remain unchanged at Korean date boundaries", () => {
  assert.deepEqual(dateRange("weekend", new Date("2026-09-20T02:00:00Z")), {
    start: "2026-09-19",
    end: "2026-09-20",
  });
  assert.deepEqual(dateRange("next-weekend", new Date("2026-09-20T02:00:00Z")), {
    start: "2026-09-26",
    end: "2026-09-27",
  });
});
