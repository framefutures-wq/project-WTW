import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateSourceReady, selectPrivateSourceWinner, type PrivateSourceReadiness } from "../shared/private-source-readiness";
import { koreanFolkSelection, parseKoreanFolkDetail, parseKoreanFolkListing } from "../shared/korean-folk-private-source";

const ready = (sourceKey: string, sourceName: string, count = 2): PrivateSourceReadiness => ({ sourceKey, sourceName, currentUpcomingCandidates: count, stableIdentityCoverage: "complete", requestCount: 6, gates: { discovery: true, identity: true, date: true, venue: true, parserHealth: true, weekendSuitability: true } });

test("private readiness requires every hard gate and uses deterministic winner selection", () => {
  const failed = ready("failed", "실패", 99); failed.gates.venue = false;
  assert.equal(isPrivateSourceReady(failed), false);
  assert.equal(selectPrivateSourceWinner([failed, ready("folk", "한국민속촌", 5), ready("other", "다른곳", 3)])?.sourceKey, "folk");
});

test("Korean Folk official promotion parser keeps numeric identity and complete official dates", () => {
  const listing = parseKoreanFolkListing('<a href="/home/promotion/event/53?utm=x"><img alt="귀신사바 귀신놀이">26.09.01(화) - 26.11.15(일)');
  assert.deepEqual(listing[0], { officialItemId: "53", officialUrl: "https://www.koreanfolk.co.kr/home/promotion/event/53", listingTitle: "귀신사바 귀신놀이", startDate: "2026-09-01", endDate: "2026-11-15" });
  assert.deepEqual(parseKoreanFolkDetail('"id",53,"title","귀신사바 귀신놀이","description","가을 특별 행사","startsAt","26.09.01","endsAt","26.11.15"'), { title: "귀신사바 귀신놀이", description: "가을 특별 행사", startDate: "2026-09-01", endDate: "2026-11-15" });
  assert.equal(koreanFolkSelection("귀신사바 귀신놀이", "가을 특별 행사"), "MAIN");
  assert.equal(koreanFolkSelection("추석 선물 상품", null), "EXCLUDE");
  assert.throws(() => parseKoreanFolkListing("<main>no official promotion marker</main>"));
});
