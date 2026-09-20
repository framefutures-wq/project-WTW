import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const REPORT = ".wrangler/companion-suitability-dry-run.json";
const TYPES = new Set(["child", "couple", "parents", "pet"]);
const STATES = new Set(["fit", "allowed", "conditional", "unknown"]);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function loadRows() {
  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  const rows = report.rows;
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("companion dry-run rows missing");
  const keys = new Set();
  for (const row of rows) {
    const key = `${row.event_id}|${row.companion_type}`;
    if (
      !row.event_id ||
      !TYPES.has(row.companion_type) ||
      !STATES.has(row.suitability_state)
    )
      throw new Error(`invalid companion row: ${key}`);
    if (row.rule_version !== "companion_rules_v1")
      throw new Error(`unexpected rule version: ${row.rule_version}`);
    if (keys.has(key)) throw new Error(`duplicate companion row: ${key}`);
    keys.add(key);
  }
  if (rows.length !== report.snapshot.event_count * 4)
    throw new Error("companion row count does not cover every event/type");
  return { report, rows };
}

function sqlFor(rows) {
  return rows
    .map(
      (row) => `INSERT INTO event_companion_suitability(
        event_id,companion_type,suitability_state,classifier_type,rule_version,rule_id,
        positive_reason_codes,caution_reason_codes,source_fact_tags,updated_at
      ) VALUES(
        ${quote(row.event_id)},${quote(row.companion_type)},${quote(row.suitability_state)},
        'deterministic_rule',${quote(row.rule_version)},${quote(row.rule_id)},
        ${quote(JSON.stringify(row.positive_reason_codes))},${quote(JSON.stringify(row.caution_reason_codes))},
        ${quote(JSON.stringify(row.source_fact_tags))},strftime('%Y-%m-%dT%H:%M:%fZ','now')
      ) ON CONFLICT(event_id,companion_type) DO UPDATE SET
        suitability_state=excluded.suitability_state,
        classifier_type=excluded.classifier_type,
        rule_version=excluded.rule_version,
        rule_id=excluded.rule_id,
        positive_reason_codes=excluded.positive_reason_codes,
        caution_reason_codes=excluded.caution_reason_codes,
        source_fact_tags=excluded.source_fact_tags,
        updated_at=excluded.updated_at
      WHERE event_companion_suitability.classifier_type='deterministic_rule';`,
    )
    .join("\n");
}

const mode = process.argv[2] ?? "plan";
if (!new Set(["plan", "apply"]).has(mode))
  throw new Error("usage: companion-suitability-operations.mjs [plan|apply]");
const { report, rows } = loadRows();
const summary = {
  mode,
  event_count: report.snapshot.event_count,
  rows: rows.length,
  insert_planned: rows.length,
  update_planned: 0,
  unchanged_planned: 0,
  stale_delete_planned: 0,
  classifier_type: "deterministic_rule",
  rule_version: "companion_rules_v1",
};
writeFileSync(".wrangler/companion-suitability-upsert.sql", sqlFor(rows));

if (mode === "apply") {
  for (let offset = 0; offset < rows.length; offset += 200) {
    const path = `.wrangler/companion-suitability-upsert-${offset}.sql`;
    writeFileSync(path, sqlFor(rows.slice(offset, offset + 200)));
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
        "--file",
        path,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          WRANGLER_LOG_PATH:
            process.env.WRANGLER_LOG_PATH ?? "/tmp/wrangler-logs",
        },
      },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log(JSON.stringify(summary, null, 2));
