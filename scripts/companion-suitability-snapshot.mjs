import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const output = ".wrangler/deployment/companion-input-snapshot.json";
const factOutput = ".wrangler/fact-tag-dry-run.json";
const statement = `
SELECT id,title,is_sample FROM events WHERE is_sample=0 ORDER BY id;
SELECT event_id,tag,rule_id,evidence_source_ref,evidence_field
FROM event_tags
WHERE classifier_type='deterministic_rule' AND rule_version='fact_rules_v1'
ORDER BY event_id,tag;
`;

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
    statement,
    "--json",
  ],
  {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? "/tmp/wrangler-logs",
    },
  },
);
if (result.status !== 0)
  throw new Error(result.stderr || "companion snapshot query failed");

const [events = [], tags = []] = JSON.parse(result.stdout).map(
  (entry) => entry.results ?? [],
);
if (!events.length) throw new Error("companion snapshot has no real events");
if (events.some((event) => !event.id || !event.title || event.is_sample))
  throw new Error("companion snapshot event shape is invalid");
if (
  tags.some(
    (tag) =>
      !tag.event_id ||
      !tag.tag ||
      !Object.hasOwn(tag, "rule_id") ||
      !Object.hasOwn(tag, "evidence_source_ref") ||
      !Object.hasOwn(tag, "evidence_field"),
  )
)
  throw new Error("companion snapshot fact-tag shape is invalid");

mkdirSync(".wrangler/deployment", { recursive: true });
writeFileSync(
  output,
  JSON.stringify({ source: "production_d1_once", events }, null, 2),
);
writeFileSync(
  factOutput,
  JSON.stringify(
    {
      snapshot: {
        event_count: events.length,
        event_tag_rows: tags.length,
        classifier_type: "deterministic_rule",
        fact_rule_version: "fact_rules_v1",
        source: output,
      },
      candidates: tags.map((tag) => ({
        event_id: tag.event_id,
        tag: tag.tag,
        rule_id: tag.rule_id,
        evidence_source: tag.evidence_source_ref,
        field: tag.evidence_field,
        evidence_text: null,
      })),
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      snapshot_count: 1,
      events_read: events.length,
      event_tags_read: tags.length,
      output,
      fact_output: factOutput,
    },
    null,
    2,
  ),
);
