import { spawnSync } from "node:child_process";
import {
  planTourApiOfficialLinkBackfill,
  validateTourApiOfficialLinkBackfill,
  type StoredTourApiGap,
} from "../shared/tourapi-official-link-backfill";
import { PUBLISH_QUALITY_RULE_VERSION } from "../shared/publish-quality";

const args = process.argv.slice(2);
if (!args.includes("--remote") || !args.includes("--apply"))
  throw new Error(
    "usage: npm run official-links:backfill:tourapi -- --remote --apply",
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
      `TourAPI official-link backfill D1 command failed${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }
  return JSON.parse(result.stdout)[0]?.results ?? [];
}

function sqlString(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}

function loadGaps() {
  return execute(
    `SELECT
       e.id,
       e.title,
       COALESCE(en.summary,e.description) AS description,
       e.venue,
       e.address,
       e.start_date,
       e.end_date,
       e.publish_quality_state AS current_publish_quality_state,
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
     LIMIT 1001`,
  ) as StoredTourApiGap[];
}

const beforeRows = loadGaps();
if (beforeRows.length > 1000)
  throw new Error("TourAPI official-link backfill gap set exceeds 1000");

const candidates = planTourApiOfficialLinkBackfill(beforeRows);
const validation = validateTourApiOfficialLinkBackfill(candidates);
if (!validation.ok)
  throw new Error(
    `TourAPI official-link backfill blocked: ${validation.blockers.join(", ")}`,
  );

const checkedAt = new Date().toISOString();
const chunkSize = 25;
for (let index = 0; index < candidates.length; index += chunkSize) {
  const chunk = candidates.slice(index, index + chunkSize);
  const values = chunk
    .map(
      (candidate) =>
        `(${sqlString(candidate.event_id)},${sqlString(candidate.source_id)},${sqlString(candidate.url)},${sqlString(checkedAt)})`,
    )
    .join(",");
  const stateCase = chunk
    .map(
      (candidate) =>
        `WHEN ${sqlString(candidate.event_id)} THEN ${sqlString(candidate.next_state)}`,
    )
    .join(" ");
  const reasonCase = chunk
    .map(
      (candidate) =>
        `WHEN ${sqlString(candidate.event_id)} THEN ${sqlString(candidate.next_reason)}`,
    )
    .join(" ");
  const ids = chunk.map((candidate) => sqlString(candidate.event_id)).join(",");

  execute(
    `INSERT INTO event_official_links(event_id,source_id,url,checked_at)
     VALUES ${values}
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

const afterRows = loadGaps();
const appliedIds = new Set(candidates.map((candidate) => candidate.event_id));
const stillMissingApplied = afterRows.filter((row) => appliedIds.has(row.id));
if (stillMissingApplied.length)
  throw new Error(
    `TourAPI official-link backfill verification failed for ${stillMissingApplied.length} applied event(s)`,
  );

console.log(
  JSON.stringify(
    {
      scanned_tourapi_link_gaps_with_cached_detail: beforeRows.length,
      explicit_homepage_candidates: candidates.length,
      inserted_or_refreshed_links: candidates.length,
      hold_to_public_promotions: validation.promotions,
      remaining_cached_detail_link_gaps: afterRows.length,
      write_batches: Math.ceil(candidates.length / chunkSize),
    },
    null,
    2,
  ),
);
