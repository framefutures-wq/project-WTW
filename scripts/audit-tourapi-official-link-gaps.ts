import { spawnSync } from "node:child_process";
import { classifyTourApiGapSignal } from "../shared/tourapi-official-link-gap";

const args = process.argv.slice(2);
if (!args.includes("--remote"))
  throw new Error("usage: npm run official-links:audit:tourapi -- --remote");

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
      `TourAPI official-link gap audit failed${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }
  return JSON.parse(result.stdout)[0]?.results ?? [];
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
   LIMIT 1001`,
) as Row[];

if (rows.length > 1000)
  throw new Error("remaining TourAPI official-link gap set exceeds 1000");

const audited = rows.map((row) => ({
  ...row,
  signal: classifyTourApiGapSignal(row),
}));

const bySignal: Record<string, number> = {};
const byState: Record<string, number> = {};
for (const row of audited) {
  bySignal[row.signal] = (bySignal[row.signal] ?? 0) + 1;
  byState[row.publish_quality_state] =
    (byState[row.publish_quality_state] ?? 0) + 1;
}

const examples = Object.fromEntries(
  [...new Set(audited.map((row) => row.signal))].map((signal) => [
    signal,
    audited
      .filter((row) => row.signal === signal)
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        title: row.title,
        region: row.region,
        state: row.publish_quality_state,
      })),
  ]),
);

console.log(
  JSON.stringify(
    {
      mode: "remote-production-read-only",
      writes: 0,
      remaining_tourapi_without_stored_official_link: audited.length,
      by_state: byState,
      by_signal: bySignal,
      examples,
    },
    null,
    2,
  ),
);
