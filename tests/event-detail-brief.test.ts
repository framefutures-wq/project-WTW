import assert from "node:assert/strict";
import test from "node:test";
import { eventDetailBrief } from "../shared/event-detail-brief";

test("짧은 공식 소개는 그대로 유지한다", () => {
  assert.deepEqual(eventDetailBrief("가을밤 한강에서 공연과 체험을 즐기는 축제입니다."), {
    text: "가을밤 한강에서 공연과 체험을 즐기는 축제입니다.",
    truncated: false,
  });
});

test("TourAPI 기본 문구는 방문 판단용 소개로 노출하지 않는다", () => {
  assert.deepEqual(
    eventDetailBrief("한국관광공사 TourAPI에 등록된 행사입니다."),
    { text: null, truncated: false },
  );
});

test("긴 원문 덤프는 첫 핵심 설명만 짧게 보여준다", () => {
  const value =
    "가족과 함께 즐기는 가을 축제입니다. 전통 공연과 체험을 한자리에서 만날 수 있습니다. " +
    "프로그램 안내 ".repeat(50);
  const result = eventDetailBrief(value, 90);
  assert.equal(result.truncated, true);
  assert.match(result.text ?? "", /^가족과 함께 즐기는 가을 축제입니다\./);
  assert((result.text?.length ?? 0) <= 92);
});

test("공백과 줄바꿈을 정리한다", () => {
  assert.deepEqual(eventDetailBrief("  첫 문장입니다.\n\n  둘째 문장입니다.  "), {
    text: "첫 문장입니다. 둘째 문장입니다.",
    truncated: false,
  });
});
