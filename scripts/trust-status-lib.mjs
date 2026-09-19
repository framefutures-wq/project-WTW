// Snapshot decisions use only reviewed audit evidence, never publication or payment flags.
export const RULE_VERSION = "trust-v1";
export const CORE = ["title", "start_date", "end_date", "venue"];
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .toLowerCase();
const present = (value) => typeof value === "string" && value.trim().length > 0;
export function assessTrust(
  event,
  audit,
  links = [],
  comparisons = [],
  reviews = {},
  evaluatedAt = new Date().toISOString(),
) {
  const result = {
    event_id: event.id,
    audit_id: audit?.id ?? null,
    trust_status: "needs_review",
    status_reason: "",
    evidence_source_id: null,
    checked_at: null,
    evaluated_at: evaluatedAt,
    decision_method: "automatic",
    rule_version: RULE_VERSION,
    changed_fields: [],
    unconfirmed_fields: [
      ...CORE,
      "address",
      "price",
      "cancelled",
      "postponed",
      "operation_change",
    ],
    evidence: [],
    requires_review: true,
    access_failure: false,
    mismatch_candidate: false,
  };
  const finish = (reason) => ({ ...result, status_reason: reason });
  if (!audit) return finish("no_audit");
  if (audit.event_id !== event.id) throw new Error("Audit event mismatch");
  const baseline = JSON.parse(audit.baseline_json).event;
  if (
    [...CORE, "address", "primary_source_id"].some(
      (f) => event[f] !== baseline[f],
    )
  )
    return finish("baseline_changed");
  links = links.filter((l) => l.audit_id === audit.id);
  comparisons = comparisons.filter((c) => c.audit_id === audit.id);
  result.access_failure = links.some((l) => l.access_status !== "ok");
  result.checked_at = [audit.checked_at, ...links.map((l) => l.checked_at)]
    .filter(Boolean)
    .sort()
    .at(-1);
  const official = links.filter(
    (l) =>
      l.official === 1 &&
      l.access_status === "ok" &&
      present(l.excerpt) &&
      present(l.content_hash),
  );
  if (!official.length)
    return finish(
      result.access_failure
        ? "source_access_failed"
        : !links.length
          ? "no_official_source"
          : "officialness_unconfirmed",
    );
  const valid = comparisons.filter(
    (c) =>
      official.some(
        (l) =>
          l.id === c.link_id && [l.url, l.final_url].includes(c.evidence_url),
      ) &&
      ["match", "mismatch", "not_comparable"].includes(c.result) &&
      present(c.official_value) &&
      present(c.excerpt) &&
      present(c.reason),
  );
  const confirmed = new Set();
  let ambiguous = false;
  for (const c of valid) {
    result.evidence.push({
      comparison_id: c.id,
      link_id: c.link_id,
      url: c.evidence_url,
      field: c.field,
      result: c.result,
      official_value: c.official_value,
      excerpt: c.excerpt,
      checked_at: c.checked_at,
    });
    const r = reviews[c.id];
    // Reviews are bound to the exact stored values and excerpt; stale reviews cannot apply.
    const reviewed =
      r &&
      r.tourapi_value === c.tourapi_value &&
      r.official_value === c.official_value &&
      r.excerpt === c.excerpt &&
      present(r.reason);
    if (reviewed) {
      result.decision_method = "automatic_with_review";
      result.evidence.at(-1).review = r;
    }
    if (
      !["cancelled", "postponed", "operation_change"].includes(c.field) &&
      (c.result === "match" ||
        (c.result === "not_comparable" && !present(c.tourapi_value)))
    )
      confirmed.add(c.field);
    if (["cancelled", "postponed", "operation_change"].includes(c.field)) {
      if (reviewed && r.resolution === "material_change") {
        result.changed_fields.push(c.field);
        result.mismatch_candidate = true;
      } else ambiguous = true;
      continue;
    }
    if (c.result !== "mismatch") continue;
    if (
      normalize(c.tourapi_value) === normalize(c.official_value) ||
      (reviewed && r.resolution === "equivalent")
    ) {
      confirmed.add(c.field);
      continue;
    }
    // Differing names/venues and operational statements require explicit semantic review.
    const dateChange =
      ["start_date", "end_date"].includes(c.field) &&
      [c.tourapi_value, c.official_value].every(
        (v) =>
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v,
      );
    if (
      CORE.includes(c.field) ||
      ["cancelled", "postponed", "operation_change"].includes(c.field)
    ) {
      if (dateChange || (reviewed && r.resolution === "material_change")) {
        result.changed_fields.push(c.field);
        result.mismatch_candidate = true;
      } else ambiguous = true;
    }
  }
  // Conflicting official values are not resolved by choosing the first source.
  for (const f of CORE)
    if (
      new Set(
        valid
          .filter((c) => c.field === f)
          .map((c) => normalize(c.official_value)),
      ).size > 1
    )
      ambiguous = true;
  result.unconfirmed_fields = result.unconfirmed_fields.filter(
    (f) => !confirmed.has(f),
  );
  result.evidence_source_id = result.evidence[0]?.link_id ?? official[0].id;
  if (ambiguous) return finish("semantic_review_required");
  if (result.changed_fields.length) {
    result.trust_status = "changed";
    result.requires_review = false;
    return finish("explicit_material_change");
  }
  if (CORE.every((f) => confirmed.has(f))) {
    result.trust_status = "confirmed";
    result.requires_review = false;
    return finish("core_officially_confirmed");
  }
  return finish("core_information_incomplete");
}
export function trustInsert(decision) {
  const row = {
    ...decision,
    changed_fields: JSON.stringify(decision.changed_fields),
    unconfirmed_fields: JSON.stringify(decision.unconfirmed_fields),
    evidence_json: JSON.stringify(decision.evidence),
    requires_review: Number(decision.requires_review),
    access_failure: Number(decision.access_failure),
    mismatch_candidate: Number(decision.mismatch_candidate),
  };
  delete row.evidence;
  const quote = (v) =>
    v == null
      ? "NULL"
      : typeof v === "number"
        ? String(v)
        : `'${String(v).replaceAll("'", "''")}'`;
  return `INSERT INTO event_trust_status (${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(quote).join(",")}) ON CONFLICT(event_id) DO UPDATE SET ${Object.keys(
    row,
  )
    .filter((k) => k !== "event_id")
    .map((k) => `${k}=excluded.${k}`)
    .join(",")};`;
}
