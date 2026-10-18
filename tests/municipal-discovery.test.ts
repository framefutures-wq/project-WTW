import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEnrichmentCandidate, parseBucheonAutumnList, parseGoyangList, parseHwaseongList, parsePajuList, parseSuwonList, selectMunicipalGate } from "../shared/municipal-discovery";

const paju = parsePajuList(readFileSync("fixtures/municipal-discovery-paju.html", "utf8"));
const suwon = parseSuwonList(readFileSync("fixtures/municipal-discovery-suwon.html", "utf8"));
const goyang = parseGoyangList(readFileSync("fixtures/municipal-discovery-goyang.html", "utf8"));
const hwaseong = parseHwaseongList(readFileSync("fixtures/municipal-discovery-hwaseong.html", "utf8"));
const bucheon = parseBucheonAutumnList(readFileSync("fixtures/municipal-discovery-bucheon.html", "utf8"));

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
  assert.equal(hwaseong.length, 5);
  assert.deepEqual([hwaseong[0].start_date, hwaseong[0].end_date], ["2026-10-03", "2026-10-04"]);
  assert.equal(hwaseong[1].start_date, "2026-10-31");
  assert.equal(selectMunicipalGate(hwaseong[0]).gate, "MAIN");
  assert.equal(hwaseong[3].parse_error, "unparseable_date");
  assert.equal(selectMunicipalGate(hwaseong[4]).gate, "EXCLUDE");
  assert.equal(hwaseong[0].official_url, "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp");
});

test("selection keeps festivals reviewable, excludes courses, and never relies on image presence", () => {
  assert.equal(selectMunicipalGate(paju[0]).gate, "MAIN");
  assert.equal(selectMunicipalGate(paju[1]).gate, "EXCLUDE");
  assert.equal(selectMunicipalGate(suwon[1]).gate, "REVIEW");
  assert.equal(selectMunicipalGate({ ...paju[0], start_date: null }).gate, "REVIEW");
  assert.equal(selectMunicipalGate({ ...paju[0], title: "제28회 임진강가요제", category: "행사", snippet: "공개 본선 가요무대" }).gate, "MAIN");
});

test("selection publishes explicit public culture genres while admin evidence takes precedence", () => {
  const gate = (title: string) =>
    selectMunicipalGate({
      ...paju[0],
      title,
      category: "공식 문화행사",
      snippet: null,
    }).gate;
  assert.equal(gate("뮤지컬 <광화문연가>"), "MAIN");
  assert.equal(gate("2026 김창옥 토크콘서트 시즌5 - 인천"), "MAIN");
  assert.equal(gate("인천시립교향악단 기획연주회"), "MAIN");
  assert.equal(gate("소프라노 독창회"), "MAIN");
  assert.equal(gate("새생명 작가회전"), "MAIN");
  assert.equal(gate("박희자 개인전"), "MAIN");
  assert.equal(gate("사진동호회 회원작품전"), "MAIN");
  assert.equal(gate("2026 아동학대예방의 날 기념식"), "EXCLUDE");
  assert.equal(gate("마을공동체 성과공유회"), "EXCLUDE");
  assert.equal(gate("시민 대상 교육 세미나"), "EXCLUDE");
  assert.equal(gate("기관 업무협의회"), "EXCLUDE");
  assert.equal(gate("성과공유회 기념 콘서트"), "EXCLUDE");
  assert.equal(gate("지역 문화 공연"), "NEARBY_ONLY");
  assert.equal(gate("시민 음악회"), "NEARBY_ONLY");
  assert.equal(gate("시민 합창 발표회"), "NEARBY_ONLY");
});

test("only event-wide labels create operating-hour candidates, not program times", () => {
  const programOnly = createEnrichmentCandidate(paju[0], "2026년 제18회 문산거리축제 프로그램 공연: 20:30");
  assert.equal(programOnly.operating_hours, null);
  const eventHours = createEnrichmentCandidate(paju[0], "2026년 제18회 문산거리축제 운영시간 12:00~21:00");
  assert.deepEqual(eventHours.operating_hours, { start_time: "12:00", end_time: "21:00" });
  assert.equal(createEnrichmentCandidate(paju[0], "다른 2026 행사").parse_error, "detail_title_mismatch");
});

test("Bucheon autumn official schedule parses explicit 2026 city events and keeps canonical source identity", () => {
  assert.equal(bucheon.length, 4);
  assert.equal(bucheon[0].title, "제53회 부천시민의 날 기념식&기념콘서트");
  assert.deepEqual([bucheon[0].start_date, bucheon[0].end_date], ["2026-10-01", "2026-10-01"]);
  assert.equal(bucheon[1].title, "2026년 부천 웰니스 페어");
  assert.deepEqual([bucheon[1].start_date, bucheon[1].end_date], ["2026-10-01", "2026-10-03"]);
  assert.equal(bucheon[2].venue, "중앙공원");
  assert.equal(selectMunicipalGate(bucheon[2]).gate, "MAIN");
  assert.equal(bucheon[3].official_url, "https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003");
  assert.equal(selectMunicipalGate(bucheon[3]).gate, "MAIN");
});
