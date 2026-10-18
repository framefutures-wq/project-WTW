import assert from "node:assert/strict";
import test from "node:test";
import { compareDateOrder } from "../shared/event-sorting";

const range = { start: "2026-09-19", end: "2026-09-20" };
const event = (id: string, start: string, end: string) => ({
  id,
  start_date: start,
  end_date: end,
});

test("선택 기간 안에 새로 시작하는 행사를 먼저 보여준다", () => {
  const ordered = [
    event("ongoing", "2026-01-01", "2026-12-31"),
    event("new-late", "2026-09-20", "2026-09-20"),
    event("new-early", "2026-09-19", "2026-09-19"),
  ].sort((a, b) => compareDateOrder(a, b, range));
  assert.deepEqual(
    ordered.map((row) => row.id),
    ["new-early", "new-late", "ongoing"],
  );
});

test("동일 정렬값은 종료일과 event id로 결정적으로 정렬한다", () => {
  const ordered = [
    event("b", "2026-09-19", "2026-09-22"),
    event("a", "2026-09-19", "2026-09-21"),
    event("c", "2026-09-19", "2026-09-21"),
  ].sort((a, b) => compareDateOrder(a, b, range));
  assert.deepEqual(ordered.map((row) => row.id), ["a", "c", "b"]);
});
