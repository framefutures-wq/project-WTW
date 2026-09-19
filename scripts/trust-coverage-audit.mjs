import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assessTrust } from "./trust-status-lib.mjs";

const remote = process.argv.includes("--remote");
const output = ".wrangler/deployment/trust-status/coverage-audit.json";
const args = [
  "wrangler",
  "d1",
  "execute",
  remote ? "weekend-mwohae-production" : "weekend-mwohae",
  remote ? "--remote" : "--local",
  "--config",
  remote ? "wrangler.production.jsonc" : "wrangler.jsonc",
  "--json",
];
const sql = [
  "SELECT * FROM events ORDER BY id",
  "SELECT * FROM official_source_audits ORDER BY id",
  "SELECT * FROM official_source_links ORDER BY id",
  "SELECT * FROM official_source_comparisons ORDER BY id",
  "SELECT * FROM event_trust_status ORDER BY event_id",
].join("; ");
const result = spawnSync("npx", [...args, "--command", sql], {
  encoding: "utf8",
  maxBuffer: 80 * 1024 * 1024,
});
if (result.status !== 0) throw new Error(result.stderr || "D1 query failed");
const [events, audits, links, comparisons, beforeRows] = JSON.parse(
  result.stdout,
).map((row) => row.results);
const auditByEvent = new Map(audits.map((row) => [row.event_id, row]));
const linksByAudit = new Map();
const comparisonsByAudit = new Map();
for (const row of links) {
  if (!linksByAudit.has(row.audit_id)) linksByAudit.set(row.audit_id, []);
  linksByAudit.get(row.audit_id).push(row);
}
for (const row of comparisons) {
  if (!comparisonsByAudit.has(row.audit_id)) comparisonsByAudit.set(row.audit_id, []);
  comparisonsByAudit.get(row.audit_id).push(row);
}
const beforeByEvent = new Map(beforeRows.map((row) => [row.event_id, row]));
const representative = new Map();
const add = (counts, event, category) => {
  counts[category] = (counts[category] ?? 0) + 1;
  const list = representative.get(category) ?? [];
  if (list.length < 3) list.push({ id: event.id, title: event.title });
  representative.set(category, list);
};
function category(event, decision) {
  const audit = auditByEvent.get(event.id);
  const sourceLinks = audit ? linksByAudit.get(audit.id) ?? [] : [];
  const sourceComparisons = audit ? comparisonsByAudit.get(audit.id) ?? [] : [];
  if (!sourceLinks.length) return "official_source_url_none";
  const official = sourceLinks.filter(
    (link) => link.official === 1 && link.access_status === "ok",
  );
  if (!official.length) {
    if (sourceLinks.some((link) => link.http_status === 429)) return "http_429";
    if (sourceLinks.some((link) => link.http_status === 403)) return "http_403";
    if (sourceLinks.some((link) => link.access_status === "network_error"))
      return "timeout_or_network_error";
    if (sourceLinks.some((link) => link.access_status === "http_error"))
      return "other_http_4xx_5xx";
    return "officialness_unconfirmed";
  }
  const mismatch = sourceComparisons.find((comparison) => comparison.result === "mismatch");
  if (mismatch?.field === "title") return "page_ok_title_comparison_failure";
  if (["start_date", "end_date"].includes(mismatch?.field))
    return "page_ok_date_comparison_failure";
  if (mismatch?.field === "venue") return "page_ok_venue_comparison_failure";
  if (decision.status_reason === "semantic_review_required")
    return "page_ok_semantic_review_required";
  if (decision.status_reason === "core_information_incomplete")
    return "official_source_core_information_insufficient";
  return "other";
}
const actualEvents = events.filter((event) => event.is_sample === 0);
const before = actualEvents.map((event) => beforeByEvent.get(event.id)).filter(Boolean);
const decisions = actualEvents.map((event) => {
  const audit = auditByEvent.get(event.id);
  return assessTrust(
    event,
    audit,
    audit ? linksByAudit.get(audit.id) ?? [] : [],
    audit ? comparisonsByAudit.get(audit.id) ?? [] : [],
    {},
    new Date().toISOString(),
  );
});
const counts = {};
for (const decision of decisions) {
  if (decision.trust_status === "needs_review") {
    const event = actualEvents.find((item) => item.id === decision.event_id);
    add(counts, event, category(event, decision));
  }
}
const transitions = decisions
  .map((decision) => ({
    event_id: decision.event_id,
    before: beforeByEvent.get(decision.event_id)?.trust_status ?? "missing",
    after: decision.trust_status,
    reason: decision.status_reason,
  }))
  .filter((row) => row.before !== row.after);
const summary = {
  evaluated_at: new Date().toISOString(),
  remote,
  total: actualEvents.length,
  before: {
    confirmed: before.filter((row) => row.trust_status === "confirmed").length,
    needs_review: before.filter((row) => row.trust_status === "needs_review").length,
    changed: before.filter((row) => row.trust_status === "changed").length,
  },
  after: {
    confirmed: decisions.filter((row) => row.trust_status === "confirmed").length,
    needs_review: decisions.filter((row) => row.trust_status === "needs_review").length,
    changed: decisions.filter((row) => row.trust_status === "changed").length,
  },
  new_confirmed: transitions.filter((row) => row.before !== "confirmed" && row.after === "confirmed").length,
  transitions,
  needs_review_categories: Object.fromEntries(
    Object.entries(counts).map(([name, count]) => [
      name,
      { count, percentage_of_needs_review: Number(((count / 249) * 100).toFixed(2)), representatives: representative.get(name) ?? [] },
    ]),
  ),
  unobservable_categories: {
    javascript_rendering_extraction_failure: 0,
    explicit_page_access_success_but_extractor_failed: 0,
  },
};
assert.equal(summary.total, 263);
assert.equal(summary.before.confirmed, 14);
assert.equal(summary.before.needs_review, 249);
mkdirSync(".wrangler/deployment/trust-status", { recursive: true });
writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
