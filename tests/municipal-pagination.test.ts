import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchMunicipalSourcePages,
  MAX_MUNICIPAL_PAGINATION_PAGES,
  MAX_MUNICIPAL_SINGLE_LIST_CANDIDATES,
  municipalSourcePageUrls,
  selectBoundedMunicipalCandidates,
} from "../shared/municipal-pagination";
import type { MunicipalCandidate } from "../shared/municipal-discovery";
import type { MunicipalSourceDefinition } from "../shared/municipal-source-registry";

const source = {
  key: "pagination-fixture",
  region: "서울",
  locality: "가상구",
  url: "https://events.example.go.kr/list?keep=yes",
  allowedHosts: ["events.example.go.kr"],
  healthMarkers: ["official"],
  expectedSignals: ["html_list"],
  ingestion: "generic_fallback",
} satisfies MunicipalSourceDefinition;

const candidate = (
  source_candidate_id: string,
  start_date: string,
  end_date = start_date,
): MunicipalCandidate => ({
  source: source.key,
  source_candidate_id,
  title: source_candidate_id,
  start_date,
  end_date,
  region: source.region,
  locality: source.locality,
  venue: "가상문화회관",
  official_url: `https://events.example.go.kr/event/${source_candidate_id}`,
  category: null,
  snippet: null,
  image_candidate: null,
});

test("non-paginated source keeps its single canonical URL and parsed order", async () => {
  const calls: string[] = [];
  const items = [
    candidate("second", "2026-12-20"),
    candidate("first", "2026-10-01"),
  ];
  const result = await fetchMunicipalSourcePages(
    source,
    "2026-09-23",
    async (url) => {
      calls.push(url);
      return "single";
    },
    async () => items.map((item) => ({ candidate: item })),
  );
  assert.deepEqual(calls, [source.url]);
  assert.deepEqual(
    result.map((item) => item.candidate.source_candidate_id),
    ["second", "first"],
  );
});

test("single-list overflow identity-dedupes and deterministically selects active then nearest future candidates", () => {
  const items = [
    candidate("ended", "2026-09-01"),
    candidate("active-later", "2026-09-20", "2026-09-27"),
    candidate("far", "2026-12-20"),
    candidate("near-b", "2026-09-24"),
    candidate("near-a", "2026-09-24"),
    candidate("active-sooner", "2026-09-21", "2026-09-24"),
    candidate("near-a", "2026-09-24"),
    ...Array.from({ length: 25 }, (_, index) =>
      candidate(`future-${String(index).padStart(2, "0")}`, `2026-10-${String((index % 20) + 1).padStart(2, "0")}`),
    ),
  ].map((candidate) => ({ candidate }));
  const first = selectBoundedMunicipalCandidates(items, "2026-09-23", 25);
  const second = selectBoundedMunicipalCandidates(items, "2026-09-23", 25);
  assert.equal(first.length, 25);
  assert.deepEqual(
    first.map((item) => item.candidate.source_candidate_id),
    second.map((item) => item.candidate.source_candidate_id),
  );
  assert.deepEqual(
    first.slice(0, 5).map((item) => item.candidate.source_candidate_id),
    ["active-sooner", "active-later", "near-a", "near-b", "future-00"],
  );
  assert.equal(first.some((item) => item.candidate.source_candidate_id === "ended"), false);
});

test("single-list overflow circuit breaker still rejects malformed candidate explosions", () => {
  const items = Array.from(
    { length: MAX_MUNICIPAL_SINGLE_LIST_CANDIDATES + 1 },
    (_, index) => ({ candidate: candidate(String(index), "2026-10-01") }),
  );
  assert.throws(
    () => selectBoundedMunicipalCandidates(items, "2026-09-23", 25),
    /source_candidate_circuit_breaker/,
  );
});

test("pagination preserves existing query parameters and sets only its page key", () => {
  const paginated = {
    ...source,
    pagination: { queryParam: "curPage", maxPages: 3 },
  } satisfies MunicipalSourceDefinition;
  assert.deepEqual(municipalSourcePageUrls(paginated), [
    "https://events.example.go.kr/list?keep=yes&curPage=1",
    "https://events.example.go.kr/list?keep=yes&curPage=2",
    "https://events.example.go.kr/list?keep=yes&curPage=3",
  ]);
});

test("invalid pagination declarations fail closed at the hard global page cap", () => {
  const invalid = {
    ...source,
    pagination: {
      queryParam: "curPage",
      maxPages: MAX_MUNICIPAL_PAGINATION_PAGES + 1,
    },
  } satisfies MunicipalSourceDefinition;
  assert.equal(municipalSourcePageUrls(invalid), null);
});

test("paginated candidates dedupe before selecting active and nearest events", async () => {
  const paginated = {
    ...source,
    pagination: { queryParam: "page", maxPages: 3 },
  } satisfies MunicipalSourceDefinition;
  const pages: Record<string, MunicipalCandidate[]> = {
    "1": [candidate("far", "2026-12-20"), candidate("duplicate", "2026-10-10")],
    "2": [
      candidate("near", "2026-09-24"),
      candidate("duplicate", "2026-10-10"),
    ],
    "3": [
      candidate("active", "2026-09-20", "2026-09-25"),
      candidate("expired", "2026-09-01"),
    ],
  };
  const result = await fetchMunicipalSourcePages(
    paginated,
    "2026-09-23",
    async (url) => new URL(url).searchParams.get("page")!,
    async (page) => pages[page].map((item) => ({ candidate: item, page })),
  );
  assert.deepEqual(
    result.map((item) => item.candidate.source_candidate_id),
    ["active", "near", "duplicate", "far", "expired"],
  );
  assert.equal(
    result.filter((item) => item.candidate.source_candidate_id === "duplicate")
      .length,
    1,
  );
  assert.equal(
    result.find((item) => item.candidate.source_candidate_id === "duplicate")
      ?.page,
    "1",
  );
  assert.deepEqual(
    result.slice(0, 3).map((item) => item.candidate.source_candidate_id),
    ["active", "near", "duplicate"],
  );
});

test("canonical retry refresh reads page-two identities with the same bounded fetch", async () => {
  const paginated = {
    ...source,
    pagination: { queryParam: "curPage", maxPages: 2 },
  } satisfies MunicipalSourceDefinition;
  const refresh = async () =>
    fetchMunicipalSourcePages(
      paginated,
      "2026-09-23",
      async (url) => new URL(url).searchParams.get("curPage")!,
      async (page) => [
        {
          candidate: candidate(
            page === "2" ? "page-two" : "page-one",
            page === "2" ? "2026-09-24" : "2026-10-20",
          ),
          page,
        },
      ],
    );
  const first = await refresh();
  const retry = await refresh();
  assert(
    first.some((item) => item.candidate.source_candidate_id === "page-two"),
  );
  assert(
    retry.some((item) => item.candidate.source_candidate_id === "page-two"),
  );
});
