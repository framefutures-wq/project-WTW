import assert from "node:assert/strict";
import test from "node:test";
import {
  USER_CONTENT_FILTERS,
  USER_CONTENT_FILTER_BY_QUERY,
} from "../shared/content-filters";
import { FACT_TAG_RULES } from "../shared/fact-tags";

test("사용자 콘텐츠 필터는 기존 query 계약과 검증된 fact tag를 연결한다", () => {
  assert.deepEqual(
    USER_CONTENT_FILTERS.map(({ queryValue }) => queryValue),
    ["food", "fireworks", "flowers", "experience", "performance"],
  );
  for (const filter of USER_CONTENT_FILTERS) {
    assert.ok(filter.label.length > 0);
    assert.ok(USER_CONTENT_FILTER_BY_QUERY[filter.queryValue]);
    for (const tag of filter.factTags) assert.ok(tag in FACT_TAG_RULES);
  }
  assert.deepEqual(USER_CONTENT_FILTER_BY_QUERY.flowers.factTags, [
    "flower_garden",
  ]);
});

test("사용자 필터 매핑은 내부 편의 태그나 보류 태그를 노출하지 않는다", () => {
  const tags = USER_CONTENT_FILTERS.flatMap((filter) => filter.factTags);
  assert.equal(new Set(tags).size, tags.length);
  assert.equal(tags.includes("parking" as never), false);
  assert.equal(tags.includes("pet_not_allowed" as never), false);
  assert.equal((tags as readonly string[]).includes("indoor"), false);
  assert.equal((tags as readonly string[]).includes("pet_allowed"), false);
});
