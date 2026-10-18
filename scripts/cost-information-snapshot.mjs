import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const output = ".wrangler/deployment/cost-information-snapshot.json";
const statement = `
SELECT e.id,e.title,e.start_date,e.end_date,e.cost,e.price_text,s.kind AS source_kind,
  json_extract(s.raw_payload,'$.usetimefestival') AS usetimefestival,
  json_extract(s.raw_payload,'$.usefee') AS usefee,
  json_extract(s.raw_payload,'$.usetime') AS usetime
FROM events e LEFT JOIN sources s ON s.id=e.primary_source_id
WHERE e.is_sample=0 ORDER BY e.id;
SELECT ev.event_id,ev.excerpt,ev.checked_at,s.kind AS source_kind
FROM event_evidence ev JOIN sources s ON s.id=ev.source_id
WHERE ev.field='price' AND s.kind!='sample' ORDER BY ev.event_id;
`;
const result = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "weekend-mwohae-production",
    "--remote",
    "--config",
    "wrangler.production.jsonc",
    "--command",
    statement,
    "--json",
  ],
  {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_LOG_PATH: "/tmp/wrangler-logs" },
  },
);
if (result.status !== 0) throw new Error(result.stderr || "cost snapshot failed");
const [events = [], evidence = []] = JSON.parse(result.stdout).map(
  (entry) => entry.results ?? [],
);
if (!events.length) throw new Error("cost snapshot contains no events");
mkdirSync(".wrangler/deployment", { recursive: true });
writeFileSync(output, JSON.stringify({ events, evidence }, null, 2));
console.log(JSON.stringify({ snapshot_count: 1, events: events.length, price_evidence: evidence.length, output }, null, 2));
