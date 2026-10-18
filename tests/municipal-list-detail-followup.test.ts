import assert from "node:assert/strict";
import test from "node:test";
import { extractMunicipalCandidates } from "../shared/municipal-discovery";
import {
  followUpMunicipalListDetails,
  MAX_MUNICIPAL_LIST_DETAIL_FETCHES,
  selectMunicipalListDetailTargets,
} from "../shared/municipal-list-detail-followup";
import type { MunicipalListDetailPartial } from "../shared/municipal-discovery";
import type { MunicipalSourceDefinition } from "../shared/municipal-source-registry";

const source = {
  key: "list-detail-fixture",
  region: "서울",
  locality: "가상구",
  url: "https://events.example.go.kr/list",
  allowedHosts: ["events.example.go.kr"],
  healthMarkers: ["공식 행사 일정"],
  expectedSignals: ["html_list"],
  ingestion: "generic_fallback",
  listDetailFollowup: { maxDetails: 10 },
} satisfies MunicipalSourceDefinition;

const list = (items: string) => `공식 행사 일정<ul>${items}</ul>`;
const partial = (
  url: string,
  title = "2026 가상구 문화축제",
): MunicipalListDetailPartial => ({
  source: source.key,
  source_candidate_id: `${title}-${url}`,
  title,
  start_date: "2026-10-24",
  end_date: "2026-10-25",
  venue: null,
  region: source.region,
  locality: source.locality,
  official_url: url,
  category: "축제",
  snippet: null,
});
const detail = (title = "2026 가상구 문화축제", venue = "가상문화광장") => `
  <article class="event-card"><h1 class="title">${title}</h1><dl>
  <dt>행사기간</dt><dd>2026년 10월 24일 ~ 2026년 10월 25일</dd>
  <dt>장소</dt><dd>${venue}</dd></dl></article>`;

test("opt-in list partials complete Mapo/Songpa-style title-date list with a detail venue", async () => {
  const extraction = extractMunicipalCandidates(
    source,
    list(
      '<li><a class="title" href="/detail/1">2026 가상구 문화축제</a><span class="date">2026-10-24 ~ 2026-10-25</span></li>',
    ),
  );
  assert.equal(extraction.mode, "generic_html");
  assert.equal(extraction.candidates.length, 0);
  assert.equal(extraction.partialCandidates?.length, 1);
  const result = await followUpMunicipalListDetails(
    source,
    extraction.partialCandidates ?? [],
    "2026-09-23",
    async (url) => ({ html: detail(), finalUrl: url }),
  );
  assert.deepEqual(
    result.candidates.map(({ candidate }) => [
      candidate.start_date,
      candidate.end_date,
      candidate.venue,
    ]),
    [["2026-10-24", "2026-10-25", "가상문화광장"]],
  );
});

test("Busan/Sejong-style detail core and Seocho-style date-less calendar both require explicit full-year detail facts", async () => {
  const calendar = extractMunicipalCandidates(
    source,
    list(
      '<li><a class="title" href="/detail/calendar">가상구 가을 문화제</a><span class="category">축제</span></li>',
    ),
  );
  assert.equal(calendar.partialCandidates?.[0].start_date, null);
  const result = await followUpMunicipalListDetails(
    source,
    calendar.partialCandidates ?? [],
    "2026-09-23",
    async (url) => ({ html: detail("가상구 가을 문화제"), finalUrl: url }),
  );
  assert.equal(result.candidates.length, 1);
  const missing = await followUpMunicipalListDetails(
    source,
    [partial("https://events.example.go.kr/detail/missing")],
    "2026-09-23",
    async (url) => ({
      html: '<article class="event-card"><h1 class="title">2026 가상구 문화축제</h1><dl><dt>기간</dt><dd>2026년 10월 24일</dd></dl></article>',
      finalUrl: url,
    }),
  );
  assert.equal(missing.candidates.length, 0);
  assert.deepEqual(
    missing.rejected.map((item) => item.reason),
    ["detail_missing_core"],
  );
});

test("cross-host redirects and list-detail core conflicts fail closed", async () => {
  const crossHost = await followUpMunicipalListDetails(
    source,
    [partial("https://events.example.go.kr/detail/cross")],
    "2026-09-23",
    async () => ({ html: detail(), finalUrl: "https://example.com/redirect" }),
  );
  assert.equal(crossHost.candidates.length, 0);
  assert.deepEqual(
    crossHost.rejected.map((item) => item.reason),
    ["detail_redirect_host_not_allowed"],
  );
  const conflict = await followUpMunicipalListDetails(
    source,
    [partial("https://events.example.go.kr/detail/conflict")],
    "2026-09-23",
    async (url) => ({
      html: detail("2026 가상구 문화축제", "다른광장").replace(
        "2026년 10월 25일",
        "2026년 10월 26일",
      ),
      finalUrl: url,
    }),
  );
  assert.equal(conflict.candidates.length, 0);
  assert.deepEqual(
    conflict.rejected.map((item) => item.reason),
    ["list_detail_core_conflict"],
  );
});

test("detail cap selection is deterministic and one failed detail does not block another", async () => {
  const capped = {
    ...source,
    listDetailFollowup: { maxDetails: 2 },
  } satisfies MunicipalSourceDefinition;
  const targets = [
    {
      ...partial("https://events.example.go.kr/detail/ended"),
      start_date: "2026-09-01",
      end_date: "2026-09-01",
    },
    {
      ...partial("https://events.example.go.kr/detail/far"),
      start_date: "2026-12-01",
      end_date: "2026-12-01",
    },
    {
      ...partial("https://events.example.go.kr/detail/active"),
      start_date: "2026-09-20",
      end_date: "2026-09-25",
    },
    {
      ...partial("https://events.example.go.kr/detail/near"),
      start_date: "2026-09-24",
      end_date: "2026-09-24",
    },
  ];
  assert.deepEqual(
    selectMunicipalListDetailTargets(targets, "2026-09-23", 2).map(
      (item) => item.official_url,
    ),
    [
      "https://events.example.go.kr/detail/active",
      "https://events.example.go.kr/detail/near",
    ],
  );
  const result = await followUpMunicipalListDetails(
    capped,
    targets,
    "2026-09-23",
    async (url) => {
      if (url.endsWith("active")) throw new Error("timeout");
      return {
        html: detail().replace(
          "2026년 10월 24일 ~ 2026년 10월 25일",
          "2026년 9월 24일 ~ 2026년 9월 24일",
        ),
        finalUrl: url,
      };
    },
  );
  assert.equal(result.attempted, 2);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(
    result.rejected.map((item) => item.reason),
    ["detail_fetch_failed"],
  );
  assert.equal(MAX_MUNICIPAL_LIST_DETAIL_FETCHES, 10);
});

test("without explicit opt-in, incomplete legacy generic lists remain retry-only", () => {
  const legacy = {
    ...source,
    listDetailFollowup: undefined,
  } satisfies MunicipalSourceDefinition;
  const extraction = extractMunicipalCandidates(
    legacy,
    list(
      '<li><a class="title" href="/detail/legacy">2026 가상구 문화축제</a><span class="date">2026-10-24</span></li>',
    ),
  );
  assert.equal(extraction.mode, "retry");
  assert.deepEqual(extraction.candidates, []);
  assert.equal(extraction.partialCandidates, undefined);
});
