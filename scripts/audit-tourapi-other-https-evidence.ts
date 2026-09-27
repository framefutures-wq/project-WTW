import { spawnSync } from "node:child_process";
import { classifyTourApiGapSignal } from "../shared/tourapi-official-link-gap";
import { pageMentionsEventTitle, selectOtherHttpsCandidates } from "../shared/tourapi-other-https-evidence";
import { extractUrls, fetchPage } from "./official-source-lib.mjs";

const args = process.argv.slice(2);
if (!args.includes("--remote"))
  throw new Error("usage: npm run official-links:audit:tourapi-other-https -- --remote");

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function execute(sql: string) {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DB,
      "--remote",
      "--config",
      CONFIG,
      "--command",
      sql,
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 24 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout).trim().slice(0, 2500);
    throw new Error(
      `TourAPI OTHER_HTTPS evidence audit failed${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }
  return JSON.parse(result.stdout)[0]?.results ?? [];
}

function parse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  title: string;
  region: string;
  publish_quality_state: "PUBLIC" | "HOLD" | "EXCLUDE";
  base_raw_payload: string | null;
  detail_raw_payload: string | null;
};

const rows = execute(
  `SELECT
     e.id,
     e.title,
     e.region,
     e.publish_quality_state,
     ps.raw_payload AS base_raw_payload,
     ds.raw_payload AS detail_raw_payload
   FROM events e
   JOIN sources ps ON ps.id=e.primary_source_id
   LEFT JOIN sources ds ON ds.id=e.id || '-detail' AND ds.kind='tourapi'
   LEFT JOIN event_official_links ol ON ol.event_id=e.id
   WHERE e.is_sample=0
     AND e.verification='verified'
     AND ps.kind='tourapi'
     AND e.end_date>='${today}'
     AND ol.event_id IS NULL
   ORDER BY e.start_date,e.id
   LIMIT 101`,
) as Row[];

if (rows.length > 100)
  throw new Error("TourAPI remaining link-gap set exceeds 100 rows");

const targetRows = rows.filter(
  (row) => classifyTourApiGapSignal(row) === "OTHER_HTTPS_URL",
);

const audited = [];
let fetches = 0;
const maxFetches = 80;

for (const row of targetRows) {
  const urls = [
    ...extractUrls(parse(row.detail_raw_payload) ?? {}, "detail"),
    ...extractUrls(parse(row.base_raw_payload) ?? {}, "base"),
  ];
  const candidates = selectOtherHttpsCandidates(urls).slice(0, 4);
  const pages = [];

  for (const candidate of candidates) {
    if (fetches >= maxFetches) break;
    fetches++;
    const page = await fetchPage(candidate.url);
    pages.push({
      ...candidate,
      final_url: page.finalUrl,
      access_status: page.accessStatus,
      http_status: page.httpStatus,
      page_title: page.title,
      title_signal:
        page.accessStatus === "ok"
          ? pageMentionsEventTitle({
              title: row.title,
              pageTitle: page.title,
              pageText: page.text,
            })
          : false,
    });
  }

  audited.push({
    id: row.id,
    title: row.title,
    region: row.region,
    state: row.publish_quality_state,
    candidate_count: candidates.length,
    pages,
  });
}

const categoryCounts: Record<string, number> = {};
let reachable = 0;
let titleSignal = 0;
let zeroCandidateEvents = 0;
for (const row of audited) {
  if (!row.candidate_count) zeroCandidateEvents++;
  for (const page of row.pages) {
    categoryCounts[page.category] = (categoryCounts[page.category] ?? 0) + 1;
    if (page.access_status === "ok") reachable++;
    if (page.title_signal) titleSignal++;
  }
}

console.log(
  JSON.stringify(
    {
      mode: "remote-production-read-only",
      writes: 0,
      other_https_events: targetRows.length,
      fetched_candidate_urls: fetches,
      by_candidate_category: categoryCounts,
      reachable_html_pages: reachable,
      pages_with_event_title_signal: titleSignal,
      events_without_nonasset_candidate_url: zeroCandidateEvents,
      events: audited.map((row) => ({
        id: row.id,
        title: row.title,
        region: row.region,
        state: row.state,
        candidates: row.pages.map((page) => ({
          url: page.url,
          path: page.path,
          category: page.category,
          final_url: page.final_url,
          access_status: page.access_status,
          http_status: page.http_status,
          page_title: page.page_title,
          title_signal: page.title_signal,
        })),
      })),
    },
    null,
    2,
  ),
);