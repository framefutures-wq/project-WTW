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

const linkRows = execute(
  `SELECT a.event_id,l.url,l.checked_at
   FROM official_source_audits a
   JOIN official_source_links l ON l.audit_id=a.id
   JOIN events e ON e.id=a.event_id
   WHERE e.is_sample=0
     AND e.verification='verified'
     AND e.end_date>='${today}'
     AND l.official=1
     AND l.access_status='ok'
     AND l.url LIKE 'https://%'
   ORDER BY a.event_id,l.checked_at DESC
   LIMIT ${Math.min(10000, requestedLimit * 5 + 1)}`,
) as Array<{ event_id: string; url: string; checked_at: string }>;

const latestOfficial = new Map<string, string>();
for (const row of linkRows)
  if (!latestOfficial.has(row.event_id))
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
  }));

const output = {
  mode: remoteMode ? "remote-production-read-only" : "local-read-only",
  as_of_kst: today,
  writes: 0,
  scanned_current_or_future_verified_events: report.total,
  by_state: report.by_state,
  by_reason: report.by_reason,
  by_source_kind: report.by_source_kind,
  by_official_link_quality: report.by_official_link_quality,
  examples: report.examples,
  official_link_gaps,
};

console.log(JSON.stringify(output, null, 2));
