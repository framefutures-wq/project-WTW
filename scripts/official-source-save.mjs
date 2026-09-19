import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const remote = process.argv.includes("--remote");
const dir = ".wrangler/deployment/official-source";
const expected = JSON.parse(readFileSync(".wrangler/deployment/tourapi-real.json", "utf8"));
const audit = JSON.parse(readFileSync(`${dir}/audit.json`, "utf8"));
const common = ["wrangler", "d1", "execute", remote ? "weekend-mwohae-production" : "weekend-mwohae", remote ? "--remote" : "--local", "--config", remote ? "wrangler.production.jsonc" : "wrangler.jsonc"];
function query(sql) {
  const result = spawnSync("npx", [...common, "--command", sql, "--json"], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("D1 audit verification query failed");
  return JSON.parse(result.stdout).map(r => r.results);
}
function canonical(rows) {
  return rows.map(r => JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k => [k, r[k]])))).sort();
}
function baseline() {
  const [events, sources, evidence] = query("SELECT e.* FROM events e JOIN sources s ON s.id=e.primary_source_id WHERE e.is_sample=0 AND s.kind='tourapi'; SELECT * FROM sources WHERE kind='tourapi'; SELECT ev.event_id,ev.source_id,ev.field,ev.excerpt,ev.checked_at FROM event_evidence ev JOIN sources s ON s.id=ev.source_id WHERE s.kind='tourapi';");
  for (const [name, rows] of Object.entries({ events, sources, evidence })) assert.deepEqual(canonical(rows), canonical(expected[name]), `${name} changed since snapshot; stop and review before saving`);
  return { events: events.length, sources: sources.length, evidence: evidence.length };
}
const before = baseline();
assert.equal(audit.audits.length, expected.events.length);
const result = spawnSync("npx", [...common, "--file", `${dir}/audit.sql`, "--json"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
if (result.status !== 0) throw new Error("D1 audit import failed; immutable run can be retried after resolving error");
const after = baseline();
const run = audit.summary.runId.replaceAll("'", "''");
const [counts, fk] = query(`SELECT (SELECT count(*) FROM official_source_audits WHERE run_id='${run}') audits, (SELECT count(*) FROM official_source_links l JOIN official_source_audits a ON a.id=l.audit_id WHERE a.run_id='${run}') links, (SELECT count(*) FROM official_source_comparisons c JOIN official_source_audits a ON a.id=c.audit_id WHERE a.run_id='${run}') comparisons; PRAGMA foreign_key_check;`);
assert.equal(counts[0].audits, audit.audits.length);
assert.equal(counts[0].links, audit.links.length);
assert.equal(counts[0].comparisons, audit.comparisons.length);
assert.deepEqual(fk, []);
const verification = { remote, runId: audit.summary.runId, before, after, counts: counts[0], foreignKeyErrors: fk.length, verifiedAt: new Date().toISOString() };
writeFileSync(`${dir}/${remote ? "remote" : "local"}-verification.json`, JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification, null, 2));
