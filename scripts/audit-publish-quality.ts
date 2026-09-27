import { spawnSync } from "node:child_process";
import {
  auditPublishQualityRows,
  type PublishQualityAuditRow,
} from "../shared/publish-quality-audit";
import {
  optionValue,
  requireRemoteReadApproval,
} from "./remote-read-guard.mjs";

const args = process.argv.slice(2);
const remoteMode = args.includes("--remote");
if (remoteMode) requireRemoteReadApproval(args, "audit-publish-quality");

const requestedLimit = Number(optionValue(args, "--limit") ?? "2000");
if (
  !Number.isInteger(requestedLimit) ||
  requestedLimit < 1 ||
  requestedLimit > 5000
)
  throw new Error("--limit must be an integer between 1 and 5000");
const exampleLimit = Number(optionValue(args, "--examples") ?? "8");
if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 25)
  throw new Error("--examples must be an integer between 1 and 25");

const database = remoteMode ? "weekend-mwohae-production" : "weekend-mwohae";
const config = remoteMode ? "wrangler.production.jsonc" : "wrangler.jsonc";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function execute(sql: string) {
  const cli = [
    "wrangler",
    "d1",
    "execute",
    database,
    ...(remoteMode ? ["--remote"] : ["--local"]),
    "--config",
    config,
    "--command",
    sql,
    "--json",
  ];
  const result = spawnSync("npx", cli, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = result.stderr.trim().slice(0, 1000);
    throw new Error(
      `publish quality audit D1 read failed${stderr ? `: ${stderr}` : ""}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  return parsed[0]?.results ?? [];
}

function tableExists(name: string) {
  const escaped = name.replaceAll("'", "''");
  const rows = execute(
    `SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='${escaped}' LIMIT 1`,
  ) as Array<{ present: number }>;
  return rows.length > 0;
}

function tableColumns(name: string) {
  const escaped = name.replaceAll("'", "''");
  return new Set(
    (
      execute(`PRAGMA table_info('${escaped}')`) as Array<{ name?: string }>
    )
      .map((row) => row.name)
      .filter((value): value is string => Boolean(value)),
  );
}

const eventColumns = tableColumns("events");
const qualityColumnsPresent = [
  "publish_quality_state",
  "publish_quality_reason",
  "publish_quality_rule_version",
  "publish_quality_checked_at",
].every((column) => eventColumns.has(column));

const currentQualityProjection = qualityColumnsPresent
  ? `e.publish_quality_state AS current_publish_quality_state,
     e.publish_quality_reason AS current_publish_quality_reason,
     e.publish_quality_rule_version AS current_publish_quality_rule_version`
  : `'PUBLIC' AS current_publish_quality_state,
     NULL AS current_publish_quality_reason,
     NULL AS current_publish_quality_rule_version`;

const rows = execute(
  `SELECT
     e.id,
     e.title,
     COALESCE(en.summary,e.description) AS description,
     e.region,
     e.venue,
     e.address,
     e.start_date,
     e.end_date,
     ${currentQualityProjection},
     s.kind AS source_kind,
     s.name AS source_name,
     s.url AS source_url
   FROM events e
   JOIN sources s ON s.id=e.primary_source_id
   LEFT JOIN event_enrichments en ON en.event_id=e.id
   WHERE e.is_sample=0
     AND e.verification='verified'
     AND e.end_date>='${today}'
   ORDER BY e.start_date,e.id
   LIMIT ${requestedLimit + 1}`,
) as PublishQualityAuditRow[];

if (rows.length > requestedLimit)
  throw new Error(
    `audit result exceeds --limit=${requestedLimit}; narrow the target or explicitly raise the bound`,
  );

const auditedOfficialRows = execute(
  `SELECT
     a.event_id,
     CASE
       WHEN l.final_url LIKE 'https://%' THEN l.final_url
       WHEN l.url LIKE 'https://%' THEN l.url
       ELSE NULL
     END AS url,
     l.checked_at
   FROM official_source_audits a
   JOIN official_source_links l ON l.audit_id=a.id
   JOIN events e ON e.id=a.event_id
   WHERE e.is_sample=0
     AND e.verification='verified'
     AND e.end_date>='${today}'
     AND l.official=1
     AND l.access_status='ok'
     AND (l.final_url LIKE 'https://%' OR l.url LIKE 'https://%')
   ORDER BY a.event_id,l.checked_at DESC
   LIMIT ${Math.min(10000, requestedLimit * 5 + 1)}`,
) as Array<{ event_id: string; url: string | null; checked_at: string }>;

const storedOfficialRows = tableExists("event_official_links")
  ? (execute(
      `SELECT
         ol.event_id,
         ol.url,
         ol.checked_at,
         s.priority AS source_priority
       FROM event_official_links ol
       JOIN events e ON e.id=ol.event_id
       JOIN sources s ON s.id=ol.source_id
       WHERE e.is_sample=0
         AND e.verification='verified'
         AND e.end_date>='${today}'
         AND ol.url LIKE 'https://%'
       ORDER BY ol.event_id,s.priority,ol.checked_at DESC
       LIMIT ${Math.min(10000, requestedLimit * 5 + 1)}`,
    ) as Array<{
      event_id: string;
      url: string | null;
      checked_at: string;
      source_priority: number;
    }>)
  : [];

const latestOfficial = new Map<string, string>();
for (const row of storedOfficialRows)
  if (row.url && !latestOfficial.has(row.event_id))
    latestOfficial.set(row.event_id, row.url);
for (const row of auditedOfficialRows)
  if (row.url && !latestOfficial.has(row.event_id))
    latestOfficial.set(row.event_id, row.url);

const inputs = rows.map((row) => ({
  ...row,
  discovered_official_url: latestOfficial.get(row.id) ?? null,
}));
const report = auditPublishQualityRows(inputs, exampleLimit);

const official_link_gaps = report.audited
  .filter(
    (row) =>
      row.official_link_quality === "TOURAPI_ONLY" ||
      row.official_link_quality === "MISSING",
  )
  .slice(0, 30)
  .map((row) => ({
    id: row.id,
    title: row.title,
    region: row.region,
    proposed_state: row.proposed.state,
    proposed_reason: row.proposed.reason,
    source_kind: row.source_kind ?? null,
    source_name: row.source_name ?? null,
    official_link_quality: row.official_link_quality,
    public_quality_risk: row.public_quality_risk,
  }));

const public_quality_risks = report.audited
  .filter((row) => row.public_quality_risk !== "NONE")
  .slice(0, 30)
  .map((row) => ({
    id: row.id,
    title: row.title,
    region: row.region,
    proposed_reason: row.proposed.reason,
    source_kind: row.source_kind ?? null,
    source_name: row.source_name ?? null,
    official_link_quality: row.official_link_quality,
    public_quality_risk: row.public_quality_risk,
  }));

const output = {
  mode: remoteMode ? "remote-production-read-only" : "local-read-only",
  as_of_kst: today,
  writes: 0,
  schema: {
    publish_quality_columns_present: qualityColumnsPresent,
    event_official_links_present: tableExists("event_official_links"),
  },
  scanned_current_or_future_verified_events: report.total,
  by_state: report.by_state,
  by_reason: report.by_reason,
  by_source_kind: report.by_source_kind,
  by_official_link_quality: report.by_official_link_quality,
  by_public_quality_risk: report.by_public_quality_risk,
  rollout: report.rollout,
  examples: report.examples,
  official_link_gaps,
  public_quality_risks,
};

console.log(JSON.stringify(output, null, 2));
