import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { FACT_CLASSIFIER, FACT_RULE_VERSION, FACT_TAGS } from "../shared/fact-tags.ts";

const DB = "weekend-mwohae-production";
const CONFIG = "wrangler.production.jsonc";
const REPORT = ".wrangler/fact-tag-dry-run.json";
const V1 = new Set(FACT_TAGS);
const quote = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
function query(sql) {
  const r = spawnSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--command", sql, "--json"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "원격 D1 조회 실패");
  return JSON.parse(r.stdout)[0]?.results ?? [];
}
function loadCandidates() {
  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  const candidates = report.candidates.filter((c) => V1.has(c.tag));
  const unknown = report.candidates.filter((c) => !V1.has(c.tag));
  const keys = candidates.map((c) => `${c.event_id}|${c.tag}`);
  const duplicate = keys.filter((key, i) => keys.indexOf(key) !== i);
  if (unknown.length || duplicate.length) throw new Error(`invariant failed: unknown=${unknown.length}, duplicate=${duplicate.length}`);
  if (candidates.some((c) => c.tag === "parking" || c.tag === "pet_not_allowed")) throw new Error("excluded tag generated");
  return { report, candidates };
}
function sqlFor(candidates) {
  const eventIds = [...new Set(candidates.map((c) => c.event_id))];
  const statements = [];
  for (const id of eventIds) statements.push(`DELETE FROM event_tags WHERE event_id=${quote(id)} AND classifier_type=${quote(FACT_CLASSIFIER)} AND rule_version=${quote(FACT_RULE_VERSION)};`);
  for (const c of candidates) statements.push(`INSERT INTO event_tags(event_id,tag,classifier_type,rule_version,rule_id,evidence_source_ref,evidence_field,evidence_excerpt,updated_at) VALUES(${quote(c.event_id)},${quote(c.tag)},${quote(FACT_CLASSIFIER)},${quote(FACT_RULE_VERSION)},${quote(c.rule_id)},${quote(c.evidence_source)},${quote(c.field)},${quote(c.evidence_text.slice(0, 1000))},strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
  return statements.join("\n");
}
const mode = process.argv[2] || "dry-run";
const { report, candidates } = loadCandidates();
const eventIds = new Set(candidates.map((c) => c.event_id));
const tagCounts = Object.fromEntries(FACT_TAGS.map((tag) => [tag, new Set(candidates.filter((c) => c.tag === tag).map((c) => c.event_id)).size]));
const summary = { event_count: report.snapshot.event_count, tagged_events: report.tagged_events, untagged_events: report.untagged_events, candidate_rows: candidates.length, event_ids_with_tags: eventIds.size, average_tags: report.snapshot.event_count ? candidates.length / report.snapshot.event_count : 0, max_tags: Math.max(0, ...[...eventIds].map((id) => candidates.filter((c) => c.event_id === id).length)), tag_counts: tagCounts, duplicate_planned: 0, unknown_tags: 0, excluded_tags: 0, classifier_type: FACT_CLASSIFIER, rule_version: FACT_RULE_VERSION };
writeFileSync(".wrangler/fact-tag-backfill.sql", sqlFor(candidates));
if (mode === "apply") {
  const ids = [...eventIds];
  for (let offset = 0; offset < ids.length; offset += 25) {
    const selected = new Set(ids.slice(offset, offset + 25));
    const chunk = candidates.filter((candidate) => selected.has(candidate.event_id));
    const path = `.wrangler/fact-tag-backfill-${offset}.sql`;
    writeFileSync(path, sqlFor(chunk));
    const r = spawnSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--file", path], { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
if (mode === "verify") {
  const rows = query(`SELECT event_id,tag,classifier_type,rule_version,rule_id,evidence_source_ref,evidence_field,evidence_excerpt FROM event_tags WHERE classifier_type=${quote(FACT_CLASSIFIER)} AND rule_version=${quote(FACT_RULE_VERSION)} ORDER BY event_id,tag`);
  const actual = new Set(rows.map((r) => `${r.event_id}|${r.tag}`));
  const expected = new Set(candidates.map((c) => `${c.event_id}|${c.tag}`));
  const orphan = query("SELECT t.event_id FROM event_tags t LEFT JOIN events e ON e.id=t.event_id WHERE e.id IS NULL");
  const invalid = rows.filter((r) => !V1.has(r.tag));
  const missing = [...expected].filter((key) => !actual.has(key));
  const extra = [...actual].filter((key) => !expected.has(key));
  if (missing.length || extra.length || invalid.length || orphan.length) throw new Error(`verification failed: missing=${missing.length}, extra=${extra.length}, invalid=${invalid.length}, orphan=${orphan.length}`);
  summary.actual_rows = rows.length; summary.missing = missing.length; summary.extra = extra.length; summary.orphan = orphan.length; summary.invalid = invalid.length;
}
console.log(JSON.stringify({ mode, ...summary }, null, 2));
