import { spawnSync } from "node:child_process";
import { setDefaultResultOrder } from "node:dns";
import { createEnrichmentCandidate, parseBucheonAutumnList, parseGoyangList, parseHwaseongList, parsePajuList, parseSuwonList, selectMunicipalGate } from "../shared/municipal-discovery.ts";
import { lookupMunicipalDuplicate } from "./municipal-duplicate-lookup.mjs";
import { manifestFingerprint, stableMunicipalCandidateId, temporalStatus, seoulToday } from "../shared/municipal-approval.ts";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const DETAIL_LIMIT = 10;
// Several municipal hosts publish unreachable IPv6 records. Prefer IPv4 without changing source URLs.
setDefaultResultOrder("ipv4first");
const LIST_URLS = {
  paju: "https://tour.paju.go.kr/user/link/cultural/BD_index.do",
  suwon: "https://www.swcf.or.kr/?p=29",
  goyang: "https://goyang.go.kr/visitgoyang/www/contents.do?key=595&searchCtgry=1674023925303",
  hwaseong: "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp",
  bucheon: "https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003",
};
const sourceUnique = (candidates) => [...new Map(candidates.map((candidate) => [`${candidate.source}|${candidate.title}|${candidate.start_date}|${candidate.end_date}|${candidate.venue}`, candidate])).values()];

function d1Read(sql) {
  if (/\b(insert|update|delete|replace|drop|alter|create)\b/i.test(sql)) throw new Error("dry-run permits D1 reads only");
  const result = spawnSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--json", "--command", sql], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "remote D1 read failed");
  return JSON.parse(result.stdout)[0];
}

async function fetchOfficial(url, cache, metrics) {
  if (cache.has(url)) return cache.get(url);
  if (metrics.official_requests >= 20) throw new Error("official request budget exceeded");
  const response = await fetch(url, { headers: { "user-agent": "WeekendMwohaeMunicipalDiscovery/1.0 dry-run" } });
  if (!response.ok) throw new Error(`official fetch ${response.status}: ${url}`);
  const text = await response.text();
  metrics.official_requests += 1;
  cache.set(url, text);
  return text;
}

export async function runMunicipalDiscovery({ fetchOfficialPage = fetchOfficial, execute = d1Read } = {}) {
  const metrics = { official_requests: 0, d1_rows_read: 0, parser_errors: 0, detail_requests: 0 };
  const cache = new Map();
  const [pajuHtml, suwonHtml, goyangHtml, hwaseongHtml, bucheonHtml] = await Promise.all([
    fetchOfficialPage(LIST_URLS.paju, cache, metrics),
    fetchOfficialPage(LIST_URLS.suwon, cache, metrics),
    fetchOfficialPage(LIST_URLS.goyang, cache, metrics),
    fetchOfficialPage(LIST_URLS.hwaseong, cache, metrics),
    fetchOfficialPage(LIST_URLS.bucheon, cache, metrics),
  ]);
  const discovered = [
    ...sourceUnique(parsePajuList(pajuHtml)).slice(0, 10),
    ...sourceUnique(parseSuwonList(suwonHtml)).slice(0, 10),
    ...sourceUnique(parseGoyangList(goyangHtml)).slice(0, 10),
    ...sourceUnique(parseHwaseongList(hwaseongHtml)).slice(0, 10),
    ...sourceUnique(parseBucheonAutumnList(bucheonHtml)).slice(0, 10),
  ];
  const results = [];
  for (const candidate of discovered) {
    const selection = selectMunicipalGate(candidate);
    if (candidate.parse_error) metrics.parser_errors += 1;
    const duplicate = candidate.start_date && candidate.end_date && candidate.venue
      ? lookupMunicipalDuplicate({ id: `candidate-${candidate.source}-${candidate.source_candidate_id}`, title: candidate.title, region: candidate.region, start_date: candidate.start_date, end_date: candidate.end_date, venue: candidate.venue, address: candidate.venue }, execute)
      : { decision: "REVIEW", exact: { meta: { rows_read: 0 }, results: [] }, nearby: { meta: { rows_read: 0 }, results: [] } };
    metrics.d1_rows_read += (duplicate.exact.meta.rows_read ?? 0) + (duplicate.nearby.meta.rows_read ?? 0);
    const eligible = (selection.gate === "MAIN" || selection.gate === "NEARBY_ONLY") && duplicate.decision === "NEW";
    let enrichment_candidate = null;
    if (eligible && metrics.detail_requests < DETAIL_LIMIT) {
      try {
        const detail = await fetchOfficialPage(candidate.official_url, cache, metrics);
        metrics.detail_requests += 1;
        enrichment_candidate = createEnrichmentCandidate(candidate, detail);
        if (enrichment_candidate.parse_error) metrics.parser_errors += 1;
      } catch (error) {
        metrics.parser_errors += 1;
        enrichment_candidate = { parse_error: error instanceof Error ? error.message : "detail_fetch_failed" };
      }
    }
    const enrichmentParseError = enrichment_candidate && typeof enrichment_candidate === "object" && "parse_error" in enrichment_candidate;
    const ready_for_review = eligible && Boolean(candidate.title && candidate.start_date && candidate.end_date && candidate.venue && candidate.official_url) && !enrichmentParseError;
    results.push({ ...candidate, candidate_id: stableMunicipalCandidateId(candidate.source, candidate.source_candidate_id, candidate.start_date), temporal_status: temporalStatus(candidate, seoulToday()), selection_gate: selection.gate, selection_reason: selection.reason, duplicate_status: duplicate.decision, duplicate_matches: [...duplicate.exact.results, ...duplicate.nearby.results].map(({ id, title }) => ({ id, title })), enrichment_candidate, ready_for_review });
  }
  const count = (key, value) => results.filter((item) => item[key] === value).length;
  return {
    generated_at: new Date().toISOString(), mode: "dry-run", production_write: false, sources: LIST_URLS,
    summary: {
      discovered: results.length, by_source: Object.fromEntries(Object.keys(LIST_URLS).map((source) => [source, results.filter((item) => item.source === source).length])),
      gates: Object.fromEntries(["MAIN", "NEARBY_ONLY", "EXCLUDE", "REVIEW"].map((value) => [value, count("selection_gate", value)])),
      duplicates: Object.fromEntries(["DUPLICATE", "LIKELY_DUPLICATE", "NEW", "REVIEW"].map((value) => [value, count("duplicate_status", value)])),
      ready_for_review: results.filter((item) => item.ready_for_review).length, ...metrics, d1_rows_written: 0,
    },
    fingerprint: manifestFingerprint(results), candidates: results,
  };
}
