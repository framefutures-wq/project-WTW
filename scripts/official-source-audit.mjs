import { readFileSync, writeFileSync } from "node:fs";
import {
  fields,
  hash,
  classify,
  compare,
  plain,
} from "./official-source-lib.mjs";
const dir = ".wrangler/deployment/official-source";
const read = (name) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8"));
const snapshot = JSON.parse(
  readFileSync(".wrangler/deployment/tourapi-real.json", "utf8"),
);
const details = read("details"),
  candidates = read("candidates"),
  pages = read("pages");
let reviews = {};
try {
  reviews = read("reviews");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const runId = `official-${hash(JSON.stringify({ snapshot, details, candidates, pages, reviews })).slice(0, 24)}`;
const quote = (v) =>
  v == null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
const sql = [],
  audits = [],
  links = [],
  comparisons = [];
function insert(table, row) {
  sql.push(
    `INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.values(row).map(quote).join(",")}) ON CONFLICT(id) DO NOTHING;`,
  );
}
for (const event of snapshot.events) {
  const detail = details[event.id.slice(8)];
  if (
    !detail ||
    !["detailCommon2", "detailIntro2"].every((endpoint) =>
      detail.results.some((r) => r.endpoint === endpoint),
    )
  )
    throw new Error(`Missing detail attempt: ${event.id}`);
  const candidate = candidates[event.id];
  if (!candidate) throw new Error(`Missing candidate inventory: ${event.id}`);
  const source = snapshot.sources.find((s) => s.id === event.primary_source_id);
  const raw = JSON.parse(source.raw_payload);
  const intro =
    detail.results.find(
      (r) => r.endpoint === "detailIntro2" && r.status === "success",
    )?.items[0] || {};
  const checkedAt = detail.results
    .map((r) => r.checkedAt)
    .sort()
    .at(-1);
  const audit = {
    id: `${runId}:${event.id}`,
    run_id: runId,
    event_id: event.id,
    origin_source_id: source.id,
    checked_at: checkedAt,
    baseline_json: JSON.stringify({
      event,
      raw,
      sourceFetchedAt: source.fetched_at,
    }),
    detail_json: JSON.stringify(detail),
    url_inventory_json: JSON.stringify(candidate.inventory),
    candidate_status: candidate.urls.length
      ? "candidates_found"
      : detail.results.some((r) => r.status !== "success")
        ? "detail_incomplete"
        : "no_candidate_url",
  };
  audits.push(audit);
  insert("official_source_audits", audit);
  const values = {
    title: raw.title,
    start_date: event.start_date,
    end_date: event.end_date,
    venue: intro.eventplace || null,
    address: event.address,
    price: intro.usetimefestival ? plain(intro.usetimefestival) : null,
    cancelled: raw.progresstype === "취소" ? "취소" : null,
    postponed: ["행사연기", "행사 연기", "연기"].includes(raw.progresstype)
      ? "연기"
      : null,
    operation_change: null,
  };
  const eventComparisons = [];
  for (const url of candidate.urls) {
    const page = pages[url];
    if (!page) throw new Error(`Missing page attempt: ${url}`);
    const review = reviews[event.id]?.[url];
    const classification = classify(page, review);
    const link = {
      id: `${audit.id}:${hash(url).slice(0, 20)}`,
      audit_id: audit.id,
      url,
      final_url: page.finalUrl,
      source_types: JSON.stringify(classification.sourceTypes),
      title: page.title,
      checked_at: page.checkedAt,
      http_status: page.httpStatus,
      access_status: page.accessStatus,
      official:
        classification.official == null
          ? null
          : Number(classification.official),
      reason: classification.reason,
      excerpt: classification.excerpt,
      content_hash: page.contentHash,
      provenance_json: JSON.stringify(
        candidate.inventory.filter((i) => i.url === url),
      ),
    };
    links.push(link);
    insert("official_source_links", link);
    if (classification.official === true)
      for (const field of fields) {
        const c = compare(
          field,
          values[field],
          review?.observations?.[field],
          page,
          classification,
        );
        eventComparisons.push({
          id: `${link.id}:${field}`,
          audit_id: audit.id,
          link_id: link.id,
          field,
          result: c.result,
          tourapi_value: c.tourapiValue,
          official_value: c.officialValue,
          evidence_url: c.evidenceUrl,
          excerpt: c.excerpt,
          checked_at: page.checkedAt,
          reason: c.reason,
        });
      }
  }
  if (!eventComparisons.length)
    for (const field of fields)
      eventComparisons.push({
        id: `${audit.id}:${field}`,
        audit_id: audit.id,
        link_id: null,
        field,
        result: "unconfirmed",
        tourapi_value: values[field] ?? null,
        official_value: null,
        evidence_url: null,
        excerpt: null,
        checked_at: checkedAt,
        reason: "공식 출처 미확보로 비교 미실시",
      });
  for (const c of eventComparisons) {
    comparisons.push(c);
    insert("official_source_comparisons", c);
  }
}
const eventIds = (predicate) =>
  new Set(audits.filter(predicate).map((a) => a.event_id)).size;
const eventLinks = (a) => links.filter((l) => l.audit_id === a.id);
const typeCount = (t) =>
  eventIds((a) =>
    eventLinks(a).some((l) => JSON.parse(l.source_types).includes(t)),
  );
const summary = {
  runId,
  totalEvents: audits.length,
  latestSnapshotEvents: snapshot.events.filter(
    (e) => e.verification === "verified",
  ).length,
  rawAnyUrlEvents: eventIds((a) => JSON.parse(a.url_inventory_json).length > 0),
  rawRelatedUrlEvents: eventIds((a) =>
    JSON.parse(a.url_inventory_json).some((u) => !u.asset && u.path.startsWith("raw.")),
  ),
  rawImageOnlyEvents: eventIds((a) =>
    JSON.parse(a.url_inventory_json).length > 0 &&
    JSON.parse(a.url_inventory_json).every((u) => u.asset || u.path.startsWith("detail")),
  ),
  rawPageUrlEvents: eventIds((a) =>
    JSON.parse(a.url_inventory_json).some(
      (u) => !u.asset && !u.path.startsWith("existing."),
    ),
  ),
  listPageUrlEvents: eventIds((a) =>
    JSON.parse(a.url_inventory_json).some(
      (u) => !u.asset && u.path.startsWith("raw."),
    ),
  ),
  officialEvents: eventIds((a) => eventLinks(a).some((l) => l.official === 1)),
  officialRecords: links.filter((l) => l.official === 1).length,
  candidateRecords: links.length,
  uniqueFetchedUrls: new Set(links.map((l) => l.url)).size,
  eventOfficialEvents: typeCount("event_official"),
  organizerOfficialEvents: typeCount("organizer_official"),
  localGovernmentEvents: typeCount("local_government"),
  visitkoreaOnlyEvents: eventIds(
    (a) =>
      eventLinks(a).some((l) =>
        JSON.parse(l.source_types).includes("visitkorea"),
      ) &&
      eventLinks(a).every((l) =>
        JSON.parse(l.source_types).every((t) => t === "visitkorea"),
      ),
  ),
  otherOnlyEvents: eventIds(
    (a) =>
      eventLinks(a).length > 0 &&
      eventLinks(a).every((l) =>
        JSON.parse(l.source_types).every((t) => t === "other"),
      ),
  ),
  unconfirmedOfficialEvents: eventIds(
    (a) => !eventLinks(a).some((l) => l.official === 1),
  ),
  noCandidateEvents: eventIds((a) => a.candidate_status === "no_candidate_url"),
  detailIncompleteEvents: eventIds((a) =>
    JSON.parse(a.detail_json).results.some((r) => r.status !== "success"),
  ),
  mismatchEvents: eventIds((a) =>
    comparisons.some((c) => c.audit_id === a.id && c.result === "mismatch"),
  ),
  comparisonFields: Object.fromEntries(
    fields.map((field) => [
      field,
      Object.fromEntries(
        ["match", "mismatch", "unconfirmed", "not_comparable"].map((result) => [
          result,
          {
            records: comparisons.filter(
              (c) => c.field === field && c.result === result,
            ).length,
            events: eventIds((a) =>
              comparisons.some(
                (c) =>
                  c.audit_id === a.id &&
                  c.field === field &&
                  c.result === result,
              ),
            ),
          },
        ]),
      ),
    ]),
  ),
  accessFailures: {
    records: links.filter((l) => l.access_status !== "ok").length,
    uniqueUrls: new Set(
      links.filter((l) => l.access_status !== "ok").map((l) => l.url),
    ).size,
    events: eventIds((a) =>
      eventLinks(a).some((l) => l.access_status !== "ok"),
    ),
  },
  accessStatuses: Object.fromEntries(
    [...new Set(links.map((l) => l.access_status))].map((status) => [
      status,
      links.filter((l) => l.access_status === status).length,
    ]),
  ),
};
writeFileSync(`${dir}/audit.sql`, sql.join("\n"));
writeFileSync(
  `${dir}/audit.json`,
  JSON.stringify({ summary, audits, links, comparisons }, null, 2),
);
writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
