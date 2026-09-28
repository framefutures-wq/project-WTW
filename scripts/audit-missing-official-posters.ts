import { spawnSync } from "node:child_process";
import { TextDecoder } from "node:util";
import { allowedUrl } from "./official-source-lib.mjs";
import {
  extractOfficialPageImageCandidates,
  extractRawPayloadImageCandidates,
} from "../shared/official-page-image-candidates";
import {
  municipalSourceAllowsUrl,
  municipalSourceByKey,
} from "../shared/municipal-source-registry";

const args = process.argv.slice(2);
if (!args.includes("--remote"))
  throw new Error("usage: npm run images:audit:missing-posters -- --remote [--summary]");
const summaryOnly = args.includes("--summary");

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const maxEvents = 120;
const maxFetches = 80;

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
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout).trim().slice(0, 3000);
    throw new Error(`missing-poster audit D1 read failed${diagnostic ? `: ${diagnostic}` : ""}`);
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

async function fetchHtml(rawUrl: string) {
  let current = rawUrl;
  const base = {
    url: rawUrl,
    final_url: rawUrl,
    access_status: "network_error",
    http_status: null as number | null,
    html: "",
  };
  try {
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      const allowed = await allowedUrl(current);
      if (allowed === false) return { ...base, final_url: current, access_status: "blocked_url" };
      if (allowed === null) return { ...base, final_url: current };
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
        headers: {
          "user-agent": "project-WTW missing-poster-audit/1.0",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirect === 5)
          return { ...base, final_url: current, access_status: "http_error", http_status: response.status };
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { ...base, final_url: current, access_status: "http_error", http_status: response.status };
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(contentType)) {
        await response.body?.cancel();
        return { ...base, final_url: current, access_status: "unsupported_content", http_status: response.status };
      }
      const reader = response.body?.getReader();
      if (!reader) return { ...base, final_url: current, access_status: "http_error", http_status: response.status };
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          return { ...base, final_url: current, access_status: "too_large", http_status: response.status };
        }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      let charset = contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
      let html = "";
      try {
        html = new TextDecoder(charset).decode(bytes);
      } catch {
        html = bytes.toString("utf8");
      }
      return {
        ...base,
        final_url: current,
        access_status: "ok",
        http_status: response.status,
        html,
      };
    }
  } catch {}
  return { ...base, final_url: current };
}

type Row = {
  id: string;
  title: string;
  region: string;
  start_date: string;
  end_date: string;
  source_kind: string;
  source_url: string;
  source_raw_payload: string | null;
  image_url: string | null;
  image_status: string | null;
  official_url: string | null;
  source_key: string | null;
};

const rows = execute(`
  SELECT
    e.id, e.title, e.region, e.start_date, e.end_date,
    s.kind AS source_kind, s.url AS source_url, s.raw_payload AS source_raw_payload,
    ei.image_url, ei.image_status,
    mcs.source_key,
    (SELECT ol.url FROM event_official_links ol
      WHERE ol.event_id=e.id ORDER BY ol.checked_at DESC LIMIT 1) AS official_url
  FROM events e
  JOIN sources s ON s.id=e.primary_source_id
  LEFT JOIN event_images ei ON ei.event_id=e.id AND ei.is_primary=1
  LEFT JOIN municipal_candidate_state mcs ON mcs.candidate_id=e.id
  WHERE e.is_sample=0
    AND e.verification='verified'
    AND e.publish_quality_state='PUBLIC'
    AND e.end_date>='${today}'
    AND (ei.event_id IS NULL OR ei.image_url IS NULL OR ei.image_status<>'ok')
  ORDER BY e.start_date,e.id
  LIMIT ${maxEvents + 1}
`) as Row[];

if (rows.length > maxEvents)
  throw new Error(`missing-poster audit exceeds bounded population (${maxEvents})`);

const audited = [];
let fetches = 0;
for (const row of rows) {
  const rawCandidates = extractRawPayloadImageCandidates(
    parse(row.source_raw_payload) ?? {},
    "source",
  );
  const registrySource = row.source_key
    ? municipalSourceByKey(row.source_key)
    : null;
  const exactPrimaryUrl =
    row.source_kind === "organizer" && row.source_url.startsWith("https://")
      ? row.source_url
      : row.source_kind === "municipality" &&
          registrySource &&
          municipalSourceAllowsUrl(registrySource, row.source_url) &&
          new URL(row.source_url).href !== new URL(registrySource.url).href
        ? row.source_url
        : null;
  const pageUrl =
    row.official_url ??
    exactPrimaryUrl ??
    (["municipality", "organizer"].includes(row.source_kind) &&
    row.source_url.startsWith("https://")
      ? row.source_url
      : null);
  const exactPage = Boolean(row.official_url || exactPrimaryUrl);
  let page = null;
  let pageCandidates = [];
  if (pageUrl && fetches < maxFetches) {
    fetches += 1;
    page = await fetchHtml(pageUrl);
    if (page.access_status === "ok")
      pageCandidates = extractOfficialPageImageCandidates(page.final_url, page.html, 8);
  }
  const classification = rawCandidates.length
    ? "RAW_PAYLOAD_IMAGE"
    : pageCandidates.length && exactPage
      ? "OFFICIAL_PAGE_IMAGE"
      : pageCandidates.length
        ? "FIRST_PARTY_SOURCE_PAGE_UNSCOPED_IMAGE"
        : page && page.access_status !== "ok"
          ? "PAGE_UNAVAILABLE"
          : "NO_IMAGE_CANDIDATE";
  audited.push({
    id: row.id,
    title: row.title,
    region: row.region,
    source_kind: row.source_kind,
    current_image_status: row.image_status ?? "missing_row",
    official_url: row.official_url,
    page_url: pageUrl,
    page_scope: row.official_url
      ? "stored_official_link"
      : exactPrimaryUrl
        ? "exact_primary_source"
        : pageUrl
          ? "unscoped_first_party_source"
          : null,
    page_access_status: page?.access_status ?? null,
    classification,
    raw_candidates: rawCandidates.slice(0, 4),
    page_candidates: pageCandidates.slice(0, 4),
  });
}

const byClassification: Record<string, number> = {};
const bySourceKind: Record<string, number> = {};
for (const item of audited) {
  byClassification[item.classification] = (byClassification[item.classification] ?? 0) + 1;
  bySourceKind[item.source_kind] = (bySourceKind[item.source_kind] ?? 0) + 1;
}

const base = {
  mode: "remote-production-read-only",
  writes: 0,
  as_of_kst: today,
  public_current_or_future_missing_primary_image: rows.length,
  fetched_official_or_first_party_pages: fetches,
  by_source_kind: bySourceKind,
  by_classification: byClassification,
  recoverable_from_existing_evidence:
    (byClassification.RAW_PAYLOAD_IMAGE ?? 0) +
    (byClassification.OFFICIAL_PAGE_IMAGE ?? 0),
};

const examples = Object.fromEntries(
  Object.keys(byClassification).map((classification) => [
    classification,
    audited
      .filter((item) => item.classification === classification)
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.title,
        source_kind: item.source_kind,
        page_access_status: item.page_access_status,
        raw_candidates: item.raw_candidates.slice(0, 1),
        page_candidates: item.page_candidates.slice(0, 2),
      })),
  ]),
);

console.log(
  JSON.stringify(
    summaryOnly ? { ...base, examples } : { ...base, events: audited },
    null,
    2,
  ),
);