import assert from "node:assert/strict";
import test from "node:test";
import { classifyOwnership, extractHomepageUrls, normalizeRegistryText, officialCandidateDomain, priorityFor } from "../shared/source-registry-candidates";

test("source registry helpers normalize safe venue and sponsor matching inputs", () => {
  assert.equal(normalizeRegistryText("스타필드 고양!"), "스타필드고양");
  assert.equal(classifyOwnership("고양시 문화재단"), "public");
  assert.equal(classifyOwnership("알 수 없는 운영사"), "mixed_or_unclear");
});
test("homepage extraction preserves organizer candidates and excludes public/map sources", () => {
  const urls = extractHomepageUrls('<a href="https://www.starfield.co.kr/events?x=1">공식</a> https://data.go.kr/x');
  assert.deepEqual(urls, ["https://www.starfield.co.kr/events?x=1", "https://data.go.kr/x"]);
  assert.equal(officialCandidateDomain(urls[0]), "starfield.co.kr");
  assert.equal(officialCandidateDomain(urls[1]), null);
});
test("priority requires current evidence rather than fame", () => {
  assert.deepEqual(priorityFor({ eventCount: 3, seed: true, sponsor: true, domain: true, dedicatedVenue: true }), { score: 80, priority: "priority_high" });
  assert.deepEqual(priorityFor({ eventCount: 1, seed: false, sponsor: false, domain: false, dedicatedVenue: false }), { score: 10, priority: "priority_low" });
});
