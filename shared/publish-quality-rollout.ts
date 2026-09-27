import {
  PUBLISH_QUALITY_RULE_VERSION,
  type PublishQualityDecision,
  type PublishQualityState,
} from "./publish-quality";

export type LegacyPublishQualityRow = {
  id: string;
  current_publish_quality_state?: PublishQualityState | null;
  current_publish_quality_rule_version?: string | null;
  proposed: PublishQualityDecision;
};

export type LegacyPublishQualityPlan = {
  ok: boolean;
  blockers: string[];
  legacyRows: LegacyPublishQualityRow[];
  visibilityChanges: number;
};

function sqlString(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}

export function validateLegacyPublishQualityPlan(input: {
  schema?: { publish_quality_columns_present?: boolean };
  scanned_current_or_future_verified_events?: number;
  audited?: LegacyPublishQualityRow[];
}): LegacyPublishQualityPlan {
  const blockers: string[] = [];
  const audited = input.audited ?? [];
  const total = input.scanned_current_or_future_verified_events ?? 0;

  if (input.schema?.publish_quality_columns_present !== true)
    blockers.push("publish_quality_schema_missing");
  if (!Number.isInteger(total) || total < 1) blockers.push("audit_empty");
  if (audited.length !== total) blockers.push("audited_rows_incomplete");

  const ids = new Set<string>();
  for (const row of audited) {
    if (!row.id) blockers.push("empty_event_id");
    if (ids.has(row.id)) blockers.push("duplicate_event_id");
    ids.add(row.id);
    if (row.proposed.rule_version !== PUBLISH_QUALITY_RULE_VERSION)
      blockers.push("unexpected_rule_version");
  }

  const legacyRows = audited.filter(
    (row) => !row.current_publish_quality_rule_version,
  );
  const visibilityChanges = legacyRows.filter(
    (row) => (row.current_publish_quality_state ?? "PUBLIC") !== row.proposed.state,
  ).length;
  const excludeCount = legacyRows.filter(
    (row) => row.proposed.state === "EXCLUDE",
  ).length;

  // First legacy rollout is deliberately conservative. We only allow
  // grandfathered PUBLIC rows to become PUBLIC/HOLD automatically. Explicit
  // EXCLUDE decisions require a later audited rollout once real examples exist.
  if (excludeCount > 0) blockers.push("legacy_exclude_requires_review");
  if (
    legacyRows.some(
      (row) =>
        row.current_publish_quality_state !== null &&
        row.current_publish_quality_state !== undefined &&
        row.current_publish_quality_state !== "PUBLIC",
    )
  )
    blockers.push("legacy_state_not_grandfathered_public");

  if (legacyRows.length > 0) {
    if (visibilityChanges > 50)
      blockers.push("legacy_visibility_changes_over_50");
    if (visibilityChanges / legacyRows.length > 0.1)
      blockers.push("legacy_visibility_change_ratio_over_10_percent");
  }

  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    legacyRows,
    visibilityChanges,
  };
}

export function buildLegacyPublishQualitySql(
  rows: LegacyPublishQualityRow[],
  checkedAt: string,
) {
  if (!rows.length) return null;
  const ids = rows.map((row) => sqlString(row.id)).join(",");
  const stateCase = rows
    .map(
      (row) =>
        `WHEN ${sqlString(row.id)} THEN ${sqlString(row.proposed.state)}`,
    )
    .join(" ");
  const reasonCase = rows
    .map(
      (row) =>
        `WHEN ${sqlString(row.id)} THEN ${sqlString(row.proposed.reason)}`,
    )
    .join(" ");

  return `BEGIN TRANSACTION;
UPDATE events
SET publish_quality_state = CASE id ${stateCase} ELSE publish_quality_state END,
    publish_quality_reason = CASE id ${reasonCase} ELSE publish_quality_reason END,
    publish_quality_rule_version = ${sqlString(PUBLISH_QUALITY_RULE_VERSION)},
    publish_quality_checked_at = ${sqlString(checkedAt)}
WHERE publish_quality_rule_version IS NULL
  AND id IN (${ids});
COMMIT;`;
}
