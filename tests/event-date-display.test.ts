import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEventDateLabel,
  overlapsDateRange,
} from "../shared/event-date-display";

const weekend = { start: "2026-09-19", end: "2026-09-20" };

test("long-running events overlap the selected weekend and use context", () => {
  assert.equal(overlapsDateRange("2026-01-01", "2026-12-31", weekend), true);
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-01-01",
      eventEnd: "2026-12-31",
      selectedRange: weekend,
      selectionMode: "weekend",
    }),
    "이번 주말에도 진행 · ~ 12.31",
  );
});

test("an event from the previous year keeps its continuing context", () => {
  assert.equal(
    formatEventDateLabel({
      eventStart: "2025-11-01",
      eventEnd: "2026-12-31",
      selectedRange: weekend,
      selectionMode: "weekend",
    }),
    "이번 주말에도 진행 · ~ 12.31",
  );
});

test("a future event outside the range does not overlap", () => {
  assert.equal(overlapsDateRange("2026-11-01", "2026-12-31", weekend), false);
});

test("events beginning during the selected range show their start context", () => {
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-09-20",
      eventEnd: "2026-10-31",
      selectedRange: weekend,
      selectionMode: "weekend",
    }),
    "9.20 시작 · ~ 10.31",
  );
});

test("one-day and fully contained events stay concise", () => {
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-09-20",
      eventEnd: "2026-09-20",
      selectedRange: weekend,
      selectionMode: "weekend",
    }),
    "9.20 하루",
  );
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-09-19",
      eventEnd: "2026-09-20",
      selectedRange: weekend,
      selectionMode: "weekend",
    }),
    "9.19 ~ 9.20",
  );
});

test("selection wording and year boundaries remain explicit", () => {
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-08-01",
      eventEnd: "2027-01-15",
      selectedRange: weekend,
      selectionMode: "custom",
    }),
    "선택 기간에도 진행 · ~ 2027.1.15",
  );
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-01-01",
      eventEnd: "2026-01-01",
      selectedRange: { start: "2026-01-01", end: "2026-01-01" },
      selectionMode: "today",
    }),
    "1.1 하루",
  );
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-01-01",
      eventEnd: "2026-01-31",
      selectedRange: { start: "2026-01-15", end: "2026-01-15" },
      selectionMode: "custom",
    }),
    "선택한 날짜에도 진행 · ~ 1.31",
  );
  assert.equal(
    formatEventDateLabel({
      eventStart: "2026-01-01",
      eventEnd: "2026-12-31",
      selectedRange: { start: "2026-09-26", end: "2026-09-27" },
      selectionMode: "next-weekend",
    }),
    "다음 주말에도 진행 · ~ 12.31",
  );
});
