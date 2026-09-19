import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import {
  optionValue,
  requireRemoteReadApproval,
} from "./remote-read-guard.mjs";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
requireRemoteReadApproval(args, "fact-tag-snapshot");

const output =
  optionValue(args, "--output") ??
  ".wrangler/deployment/fact-tag-snapshot.json";
const db = remote ? "weekend-mwohae-production" : "weekend-mwohae";
const config = remote ? "wrangler.production.jsonc" : "wrangler.jsonc";
const target = remote ? "remote production D1" : "local D1";
if (remote)
  console.warn(
    `fact-tag-snapshot: ${target} 전체 분석 snapshot을 1회 생성합니다. 이후 QA는 ${output}을 사용하세요.`,
  );

const statements = [
  `SELECT e.*,s.fetched_at AS source_fetched_at,s.raw_payload AS tourapi_raw
   FROM events e JOIN sources s ON s.id=e.primary_source_id
   WHERE e.is_sample=0 AND s.kind='tourapi' ORDER BY e.id`,
  `SELECT ev.id,ev.event_id,ev.source_id,ev.field,ev.excerpt,ev.checked_at,
   s.kind AS source_kind,s.name AS source_name,s.fetched_at AS source_fetched_at
   FROM event_evidence ev JOIN sources s ON s.id=ev.source_id
   WHERE ev.event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY ev.id`,
  `SELECT * FROM official_source_audits
   WHERE event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY id`,
  `SELECT l.*,a.event_id FROM official_source_links l
   JOIN official_source_audits a ON a.id=l.audit_id
   WHERE a.event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY l.id`,
  `SELECT c.*,a.event_id FROM official_source_comparisons c
   JOIN official_source_audits a ON a.id=c.audit_id
   WHERE a.event_id IN (SELECT id FROM events WHERE is_sample=0) ORDER BY c.id`,
  `SELECT id,provider,status,started_at,finished_at,message FROM sync_runs
   WHERE provider='tourapi' ORDER BY started_at DESC LIMIT 10`,
];
const result = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    db,
    remote ? "--remote" : "--local",
    "--config",
    config,
    "--command",
    statements.join(";\n"),
    "--json",
  ],
  { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
);
if (result.status !== 0)
  throw new Error(result.stderr || `${target} snapshot query failed`);
const rows = JSON.parse(result.stdout).map((entry) => entry.results ?? []);
const [events, evidence, audits, links, comparisons, syncRuns] = rows;
if (!events.length)
  throw new Error(`${target} has no real TourAPI events to snapshot`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: remote ? "remote_d1_read" : "local_d1_read",
      events,
      evidence,
      audits,
      links,
      comparisons,
      syncRuns,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      target,
      output,
      events: events.length,
      evidence: evidence.length,
      audits: audits.length,
      links: links.length,
      comparisons: comparisons.length,
    },
    null,
    2,
  ),
);
