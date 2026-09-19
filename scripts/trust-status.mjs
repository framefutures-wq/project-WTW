import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assessTrust, trustInsert } from "./trust-status-lib.mjs";
const reviews = JSON.parse(
  readFileSync(new URL("./trust-status-reviews.json", import.meta.url), "utf8"),
);
const remote = process.argv.includes("--remote");
const apply = process.argv.includes("--apply");
const dir = ".wrangler/deployment/trust-status";
mkdirSync(dir, { recursive: true });
const args = [
  "wrangler",
  "d1",
  "execute",
  remote ? "weekend-mwohae-production" : "weekend-mwohae",
  remote ? "--remote" : "--local",
  "--config",
  remote ? "wrangler.production.jsonc" : "wrangler.jsonc",
];
function execute(extra) {
  const r = spawnSync("npx", [...args, ...extra, "--json"], {
    encoding: "utf8",
    maxBuffer: 60 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error("D1 trust operation failed; inspect local Wrangler logs");
  // File imports print upload progress before JSON; only queries need parsing.
  if (extra.includes("--file")) return [];
  return JSON.parse(r.stdout).map((x) => x.results);
}
const tables = [
  "events",
  "sources",
  "event_evidence",
  "official_source_audits",
  "official_source_links",
  "official_source_comparisons",
];
function snapshot() {
  return execute([
    "--command",
    tables.map((t) => `SELECT * FROM ${t} ORDER BY id;`).join("\n"),
  ]);
}
const before = snapshot();
const [events, , , audits, links, comparisons] = before;
const now = new Date().toISOString();
const decisions = events
  .filter((e) => e.is_sample === 0)
  .map((e) => {
    const audit = audits
      .filter((a) => a.event_id === e.id)
      .sort(
        (a, b) =>
          b.checked_at.localeCompare(a.checked_at) || b.id.localeCompare(a.id),
      )[0];
    return assessTrust(e, audit, links, comparisons, reviews, now);
  });
const count = (predicate) => decisions.filter(predicate).length;
const summary = {
  evaluatedAt: now,
  remote,
  total: decisions.length,
  confirmed: count((d) => d.trust_status === "confirmed"),
  needs_review: count((d) => d.trust_status === "needs_review"),
  changed: count((d) => d.trust_status === "changed"),
  reasons: Object.fromEntries(
    [...new Set(decisions.map((d) => d.status_reason))]
      .sort()
      .map((r) => [r, count((d) => d.status_reason === r)]),
  ),
  automatic_unresolved: count((d) => d.requires_review),
  access_failure_needs_review: count(
    (d) => d.trust_status === "needs_review" && d.access_failure,
  ),
  access_failure_primary_reason: count(
    (d) => d.status_reason === "source_access_failed",
  ),
  material_change_candidates: count((d) => d.mismatch_candidate),
  audit: {
    official: count((d) =>
      links.some((l) => l.audit_id === d.audit_id && l.official === 1),
    ),
    no_official: count(
      (d) => !links.some((l) => l.audit_id === d.audit_id && l.official === 1),
    ),
    access_failure: count((d) => d.access_failure),
    comparable: count((d) =>
      comparisons.some(
        (c) =>
          c.audit_id === d.audit_id && ["match", "mismatch"].includes(c.result),
      ),
    ),
    mismatch: count((d) =>
      comparisons.some(
        (c) => c.audit_id === d.audit_id && c.result === "mismatch",
      ),
    ),
  },
};
summary.audit.not_comparable = summary.total - summary.audit.comparable;
writeFileSync(
  `${dir}/${remote ? "remote" : "local"}-decisions.json`,
  JSON.stringify(decisions, null, 2),
);
writeFileSync(`${dir}/apply.sql`, decisions.map(trustInsert).join("\n"));
if (apply) {
  assert.deepEqual(
    snapshot(),
    before,
    "Source changed during evaluation; rerun",
  );
  execute(["--file", `${dir}/apply.sql`]);
  assert.deepEqual(
    snapshot(),
    before,
    "Original data changed during application",
  );
  const [saved, fk] = execute([
    "--command",
    "SELECT * FROM event_trust_status ORDER BY event_id; PRAGMA foreign_key_check;",
  ]);
  assert.deepEqual(fk, []);
  for (const d of decisions) {
    const row = saved.find((r) => r.event_id === d.event_id);
    assert(row);
    for (const [key, value] of Object.entries(d))
      assert.deepEqual(
        key === "evidence"
          ? JSON.parse(row.evidence_json)
          : Array.isArray(value)
            ? JSON.parse(row[key])
            : typeof value === "boolean"
              ? Boolean(row[key])
              : row[key],
        value,
        key,
      );
  }
  summary.saved = decisions.length;
  summary.original_data_unchanged = true;
}
writeFileSync(
  `${dir}/${remote ? "remote" : "local"}-summary.json`,
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
