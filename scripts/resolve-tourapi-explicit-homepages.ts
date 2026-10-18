import { spawnSync } from "node:child_process";
import {
  explicitHomepageCandidateFromStoredDetail,
} from "../shared/tourapi-official-link-gap";
import { fetchPage } from "./official-source-lib.mjs";
import { decidePublishQuality, PUBLISH_QUALITY_RULE_VERSION } from "../shared/publish-quality";

const args = process.argv.slice(2);
if (!args.includes("--remote") || !args.includes("--apply"))
  throw new Error(
    "usage: npm run official-links:resolve:tourapi-explicit -- --remote --apply",
  );

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
      `TourAPI explicit homepage resolver D1 command failed${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }
  return JSON.parse(result.stdout)[0]?.results ?? [];
}

function sqlString(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function blockedHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return [
      "data.go.kr",
      "apis.data.go.kr",
      "api.visitkorea.or.kr",
      "apis.visitkorea.or.kr",
    ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return true;
  }
}

type Row = {
  id: string;
  title: string;
  description: string | null;
  venue: string | null;
  address: string | null;
  start_date: string;
  end_date: string;
  publish_quality_state: "PUBLIC" | "HOLD" | "EXCLUDE";
  detail_source_id: string;
  detail_raw_payload: string | null;
};

const rows = execute(
  `SELECT
     e.id,
     e.title,
     COALESCE(en.summary,e.description) AS description,
     e.venue,
     e.address,
     e.start_date,
     e.end_date,
     e.publish_quality_state,
     ds.id AS detail_source_id,
     ds.raw_payload AS detail_raw_payload
   FROM events e
   JOIN sources ps ON ps.id=e.primary_source_id
   JOIN sources ds ON ds.id=e.id || '-detail' AND ds.kind='tourapi'
   LEFT JOIN event_enrichments en ON en.event_id=e.id
   LEFT JOIN event_official_links ol ON ol.event_id=e.id
   WHERE e.is_sample=0
     AND e.verification='verified'
     AND ps.kind='tourapi'
     AND e.end_date>=${sqlString(today)}
     AND ol.event_id IS NULL
   ORDER BY e.start_date,e.id
   LIMIT 101`,
) as Row[];

if (rows.length > 100)
  throw new Error("explicit TourAPI homepage resolver set exceeds 100 rows");

const candidates = rows
  .map((row) => ({
    row,
    candidate: explicitHomepageCandidateFromStoredDetail(row.detail_raw_payload),
  }))
  .filter(
    (item): item is {
      row: Row;
      candidate: NonNullable<
        ReturnType<typeof explicitHomepageCandidateFromStoredDetail>
      >;
    } => item.candidate !== null,
  );

const resolved: Array<{
  row: Row;
  url: string;
  nextState: "PUBLIC" | "HOLD" | "EXCLUDE";
  nextReason: string;
  method: string;
}> = [];
const unresolved: Array<{ id: string; title: string; method: string; status: string }> = [];

for (const { row, candidate } of candidates) {
  const attempts =
    candidate.kind === "http"
      ? [
          { method: "https_upgrade", url: candidate.url.replace(/^http:/i, "https:") },
          { method: "http_redirect", url: candidate.url },
        ]
      : [{ method: "bare_host_https", url: candidate.url }];

  let accepted: { url: string; method: string } | null = null;
  let lastStatus = "not_attempted";
  for (const attempt of attempts) {
    if (blockedHost(attempt.url)) {
      lastStatus = "blocked_host";
      continue;
    }
    const page = await fetchPage(attempt.url);
    lastStatus = page.accessStatus;
    if (
      page.accessStatus === "ok" &&
      page.finalUrl.startsWith("https://") &&
      !blockedHost(page.finalUrl)
    ) {
      accepted = { url: page.finalUrl, method: attempt.method };
      break;
    }
  }

  if (!accepted) {
    unresolved.push({
      id: row.id,
      title: row.title,
      method: candidate.kind,
      status: lastStatus,
    });
    continue;
  }

  const quality = decidePublishQuality({
    title: row.title,
    description: row.description,
    start_date: row.start_date,
    end_date: row.end_date,
    venue: row.venue,
    address: row.address,
    source_kind: "tourapi",
    source_url: "https://www.data.go.kr/data/15101578/openapi.do",
    event_official_url: accepted.url,
  });

  if (
    quality.state === "EXCLUDE" ||
    (row.publish_quality_state === "PUBLIC" && quality.state !== "PUBLIC")
  )
    throw new Error(
      `resolver would reduce visibility for ${row.id}: ${row.publish_quality_state}->${quality.state}`,
    );

  resolved.push({
    row,
    url: accepted.url,
    nextState: quality.state,
    nextReason: quality.reason,
    method: accepted.method,
  });
}

const checkedAt = new Date().toISOString();
const chunkSize = 20;
for (let index = 0; index < resolved.length; index += chunkSize) {
  const chunk = resolved.slice(index, index + chunkSize);
  const linkValues = chunk
    .map(
      ({ row, url }) =>
        `(${sqlString(row.id)},${sqlString(row.detail_source_id)},${sqlString(url)},${sqlString(checkedAt)})`,
    )
    .join(",");
  const stateCase = chunk
    .map(
      ({ row, nextState }) =>
        `WHEN ${sqlString(row.id)} THEN ${sqlString(nextState)}`,
    )
    .join(" ");
  const reasonCase = chunk
    .map(
      ({ row, nextReason }) =>
        `WHEN ${sqlString(row.id)} THEN ${sqlString(nextReason)}`,
    )
    .join(" ");
  const ids = chunk.map(({ row }) => sqlString(row.id)).join(",");

  execute(
    `INSERT INTO event_official_links(event_id,source_id,url,checked_at)
     VALUES ${linkValues}
     ON CONFLICT(event_id,source_id)
     DO UPDATE SET url=excluded.url,checked_at=excluded.checked_at;
     UPDATE events
     SET publish_quality_state=CASE id ${stateCase} ELSE publish_quality_state END,
         publish_quality_reason=CASE id ${reasonCase} ELSE publish_quality_reason END,
         publish_quality_rule_version=${sqlString(PUBLISH_QUALITY_RULE_VERSION)},
         publish_quality_checked_at=${sqlString(checkedAt)}
     WHERE id IN (${ids})
       AND publish_quality_state IN ('PUBLIC','HOLD');`,
  );
}

const remaining = execute(
  `SELECT COUNT(*) AS n
   FROM events e
   JOIN sources ps ON ps.id=e.primary_source_id
   LEFT JOIN event_official_links ol ON ol.event_id=e.id
   WHERE e.is_sample=0
     AND e.verification='verified'
     AND ps.kind='tourapi'
     AND e.end_date>=${sqlString(today)}
     AND ol.event_id IS NULL`,
)[0]?.n ?? null;

const byMethod: Record<string, number> = {};
let promotions = 0;
for (const item of resolved) {
  byMethod[item.method] = (byMethod[item.method] ?? 0) + 1;
  if (item.row.publish_quality_state === "HOLD" && item.nextState === "PUBLIC")
    promotions++;
}

console.log(
  JSON.stringify(
    {
      scanned_remaining_tourapi_gaps: rows.length,
      explicit_legacy_homepage_candidates: candidates.length,
      resolved_https_links: resolved.length,
      by_method: byMethod,
      hold_to_public_promotions: promotions,
      unresolved_explicit_candidates: unresolved.length,
      remaining_tourapi_without_stored_official_link: Number(remaining),
      unresolved_examples: unresolved.slice(0, 10),
      write_batches: Math.ceil(resolved.length / chunkSize),
    },
    null,
    2,
  ),
);
