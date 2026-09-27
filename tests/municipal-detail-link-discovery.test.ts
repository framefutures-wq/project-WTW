import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverMunicipalDetailUrl,
  extractMunicipalCandidates,
} from "../shared/municipal-discovery";
import {
  municipalSourceByKey,
  type MunicipalSourceDefinition,
} from "../shared/municipal-source-registry";

test("detail-link discovery prefers a first-party event detail over image/download links", () => {
  const source: MunicipalSourceDefinition = {
    key: "fixture",
    region: "서울",
    locality: "서울",
    url: "https://city.example.go.kr/events/list.do?mid=10",
    allowedHosts: ["city.example.go.kr"],
    healthMarkers: ["event-list"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
  };
  const html = `
    <li class="event-item">
      <a href="/file/down.do?fkey=poster"><img src="/file/down.do?fkey=poster"></a>
      <a href="https://map.example.com/place/1">길찾기</a>
      <a href="/events/detail.do?eventSn=77&mid=10">행사 상세</a>
    </li>
  `;

  assert.equal(
    discoverMunicipalDetailUrl(source, html),
    "https://city.example.go.kr/events/detail.do?eventSn=77&mid=10",
  );
});

test("Hangang JS-only cards resolve the deterministic evntSn detail URL", () => {
  const source = municipalSourceByKey("seoul-hangang");
  assert(source);
  const html = `
    <li class="event-item" onclick="fnDetail('462')">
      <span class="category">축제</span>
      <strong class="title">달빛 한가위 마당 (차없는 잠수교 뚜벅뚜벅 축제)</strong>
      <span class="date">2026-09-27 ~ 2026-09-27</span>
      <span class="place">반포한강공원 잠수교 달빛광장</span>
      <a href="/www/file/down.do?fkey=poster">포스터</a>
    </li>
  `;

  assert.equal(
    discoverMunicipalDetailUrl(source, html),
    "https://hangang.seoul.go.kr/www/eventMng/detail.do?mid=538&srchType=list&evntSn=462",
  );

  const extracted = extractMunicipalCandidates(
    source,
    '<ul class="board-list type-event">' + html + "</ul>",
  );
  assert.equal(extracted.mode, "generic_html");
  assert.equal(extracted.candidates.length, 1);
  assert.equal(
    extracted.candidates[0]?.official_url,
    "https://hangang.seoul.go.kr/www/eventMng/detail.do?mid=538&srchType=list&evntSn=462",
  );
});

test("detail-link discovery rejects off-site, asset and download-only targets", () => {
  const source: MunicipalSourceDefinition = {
    key: "fixture",
    region: "경기",
    locality: "가상",
    url: "https://city.example.go.kr/event/list.do",
    allowedHosts: ["city.example.go.kr"],
    healthMarkers: ["event-list"],
    expectedSignals: ["html_list"],
    ingestion: "generic_fallback",
  };
  const html = `
    <div>
      <a href="https://evil.example.com/event/detail.do?id=1">외부 링크</a>
      <a href="/images/poster.jpg">포스터</a>
      <a href="/download/file.do?id=9">첨부</a>
    </div>
  `;

  assert.equal(discoverMunicipalDetailUrl(source, html), source.url);
});
