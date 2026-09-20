import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEnrichmentCandidate, parseGoyangList, parseHwaseongList, parsePajuList, parseSuwonList, selectMunicipalGate } from "../shared/municipal-discovery";

const paju = parsePajuList(readFileSync("fixtures/municipal-discovery-paju.html", "utf8"));
const suwon = parseSuwonList(readFileSync("fixtures/municipal-discovery-suwon.html", "utf8"));
const goyang = parseGoyangList(readFileSync("fixtures/municipal-discovery-goyang.html", "utf8"));
const hwaseong = parseHwaseongList(readFileSync("fixtures/municipal-discovery-hwaseong.html", "utf8"));

test("municipal adapters extract official list candidates and preserve optional images", () => {
  assert.equal(paju.length, 3);
  assert.equal(paju[0].source_candidate_id, "940");
  assert.equal(paju[0].image_candidate?.url, "https://tour.paju.go.kr/upload/munsan.jpg");
  assert.equal(suwon.length, 3);
  assert.equal(suwon[0].source_candidate_id, "3049");
  assert.equal(suwon[0].image_candidate, null);
});

test("Goyang representative-festival parser accepts explicit 2026 dates and keeps its official detail identity", () => {
  assert.equal(goyang.length, 1);
  assert.equal(goyang[0].title, "행주가 예술이야");
  assert.equal(goyang[0].start_date, "2026-10-09");
  assert.equal(goyang[0].official_url, "https://www.goyang.go.kr/visitgoyang/www/contents.do?key=832");
  assert.equal(goyang[0].image_candidate?.url, "https://goyang.go.kr/visitgoyang/site/www/images/contents/cts595_img2.jpg");
  assert.equal(selectMunicipalGate(goyang[0]).gate, "MAIN");
});

test("Hwaseong official schedule uses its explicit heading year, preserves a one-day event, and excludes education", () => {
  assert.equal(hwaseong.length, 4);
  assert.deepEqual([hwaseong[0].start_date, hwaseong[0].end_date], ["2026-10-03", "2026-10-04"]);
  assert.equal(hwaseong[1].start_date, "2026-10-31");
  assert.equal(selectMunicipalGate(hwaseong[0]).gate, "MAIN");
  assert.equal(selectMunicipalGate(hwaseong[3]).gate, "EXCLUDE");
  assert.equal(hwaseong[0].official_url, "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp");
});

test("selection keeps festivals reviewable, excludes courses, and never relies on image presence", () => {
  assert.equal(selectMunicipalGate(paju[0]).gate, "MAIN");
  assert.equal(selectMunicipalGate(paju[1]).gate, "EXCLUDE");
  assert.equal(selectMunicipalGate(suwon[1]).gate, "REVIEW");
  assert.equal(selectMunicipalGate({ ...paju[0], start_date: null }).gate, "REVIEW");
  assert.equal(selectMunicipalGate({ ...paju[0], title: "제28회 임진강가요제", category: "행사", snippet: "공개 본선 가요무대" }).gate, "MAIN");
});

test("only event-wide labels create operating-hour candidates, not program times", () => {
  const programOnly = createEnrichmentCandidate(paju[0], "2026년 제18회 문산거리축제 프로그램 공연: 20:30");
  assert.equal(programOnly.operating_hours, null);
  const eventHours = createEnrichmentCandidate(paju[0], "2026년 제18회 문산거리축제 운영시간 12:00~21:00");
  assert.deepEqual(eventHours.operating_hours, { start_time: "12:00", end_time: "21:00" });
  assert.equal(createEnrichmentCandidate(paju[0], "다른 2026 행사").parse_error, "detail_title_mismatch");
});
