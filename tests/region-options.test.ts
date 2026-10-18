import assert from "node:assert/strict";
import test from "node:test";
import { REGIONS } from "../shared/domain";
import { REGION_OPTIONS, regionLabel } from "../shared/region-options";

test("지역 옵션은 기존 region query 계약을 그대로 사용한다", () => {
  assert.deepEqual(
    REGION_OPTIONS.map((option) => option.queryValue),
    [...REGIONS],
  );
  assert.equal(regionLabel("서울"), "서울");
  assert.equal(regionLabel("전남광주"), "전남광주");
  assert.equal(regionLabel("없는지역"), "없는지역");
});
