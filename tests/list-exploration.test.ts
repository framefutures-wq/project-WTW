import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VISIBLE_ITEMS,
  PAGE_SIZE,
  PAGES_PER_BATCH,
  batchStartPage,
  hasNextBatch,
  totalPages,
  uniqueEvents,
} from "../shared/list-exploration";

test("목록 탐색 상수와 페이지 경계가 고정된다", () => {
  assert.equal(PAGE_SIZE, 12);
  assert.equal(PAGES_PER_BATCH, 3);
  assert.equal(MAX_VISIBLE_ITEMS, 36);
  assert.equal(totalPages(7), 1);
  assert.equal(totalPages(37), 4);
  assert.equal(batchStartPage(0), 1);
  assert.equal(batchStartPage(1), 4);
  assert.equal(hasNextBatch(1, 37), true);
  assert.equal(hasNextBatch(1, 36), false);
  assert.equal(hasNextBatch(4, 120), true);
  assert.equal(hasNextBatch(10, 120), false);
});

test("묶음은 event id 중복을 표시하지 않는다", () => {
  const rows = uniqueEvents([
    { id: "a", title: "첫 행사" },
    { id: "a", title: "중복 행사" },
    { id: "b", title: "둘째 행사" },
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["a", "b"],
  );
});

test("지원하는 결과 수에서 묶음 경계와 표시 범위가 안정적이다", () => {
  for (const total of [0, 1, 7, 12, 24, 36, 37, 72, 120]) {
    const pages = totalPages(total);
    assert.equal(pages, total === 0 ? 0 : Math.ceil(total / PAGE_SIZE));
    assert.equal(hasNextBatch(1, total), total > MAX_VISIBLE_ITEMS);
    if (total > MAX_VISIBLE_ITEMS) {
      const next = batchStartPage(1);
      assert.equal(next, 4);
      assert.equal(Math.min(next * PAGE_SIZE, total), Math.min(48, total));
    }
  }
  assert.equal(Math.min(PAGES_PER_BATCH * PAGE_SIZE, 120), MAX_VISIBLE_ITEMS);
  assert.equal(Math.min(10 * PAGE_SIZE, 120), 120);
});
