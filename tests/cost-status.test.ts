import assert from "node:assert/strict";
import test from "node:test";
import { assessCost, USER_COST_FILTERS } from "../shared/cost-status";

test("비용 문구는 무료·유료·unknown을 보수적으로 판정한다", () => {
  assert.equal(assessCost("입장 무료").status, "free");
  assert.equal(assessCost("관람 무료").status, "free");
  assert.equal(assessCost("성인 5,000원").status, "paid");
  assert.equal(assessCost("입장권 10,000원").status, "paid");
  assert.equal(assessCost(null).status, "unknown");
  assert.equal(assessCost("홈페이지 참고").status, "unknown");
});

test("부가 서비스·일부 프로그램 비용은 행사 전체 상태로 확대하지 않는다", () => {
  assert.equal(assessCost("무료 주차").status, "unknown");
  assert.equal(assessCost("유료 셔틀버스").status, "unknown");
  assert.equal(assessCost("입장 무료 · 체험 비용 별도").status, "unknown");
  assert.equal(assessCost("무료 관람 · 음식 구매 별도").status, "free");
  assert.equal(assessCost("일부 프로그램 유료").status, "unknown");
  assert.equal(assessCost("체험권 5,000원").status, "unknown");
  assert.equal(assessCost("체험비 3,000원").status, "unknown");
  assert.equal(assessCost("음식 5,000원").status, "unknown");
  assert.equal(assessCost("2025년 입장료 10,000원", 2026).status, "unknown");
});

test("사용자 비용 필터는 전체·무료·유료만 노출한다", () => {
  assert.deepEqual(USER_COST_FILTERS, [
    { queryValue: "", label: "전체" },
    { queryValue: "free", label: "무료" },
    { queryValue: "paid", label: "유료" },
  ]);
});
