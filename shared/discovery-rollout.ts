export type DiscoveryRolloutAudit = {
  mode?: string;
  writes?: number;
  scanned_current_or_future_verified_events?: number;
  by_state?: {
    PUBLIC?: number;
    HOLD?: number;
    EXCLUDE?: number;
  };
  by_official_link_quality?: Record<string, number>;
  by_public_quality_risk?: Record<string, number>;
  rollout?: {
    current_state?: Record<string, number>;
    proposed_transitions?: Record<string, number>;
    legacy_unversioned?: number;
    proposed_visibility_changes?: number;
  };
};

export type DiscoveryRolloutAuditValidation = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
};

export function validateDiscoveryRolloutAudit(
  report: DiscoveryRolloutAudit,
): DiscoveryRolloutAuditValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const total = report.scanned_current_or_future_verified_events ?? 0;
  const publicCount = report.by_state?.PUBLIC ?? 0;
  const holdCount = report.by_state?.HOLD ?? 0;
  const excludeCount = report.by_state?.EXCLUDE ?? 0;
  const classified = publicCount + holdCount + excludeCount;

  if (report.mode !== "remote-production-read-only")
    blockers.push("audit_not_remote_production");
  if (report.writes !== 0) blockers.push("audit_writes_not_zero");
  if (!Number.isInteger(total) || total < 1) blockers.push("audit_empty");
  if (classified !== total) blockers.push("audit_state_total_mismatch");
  if (publicCount < 1) blockers.push("audit_zero_public");

  if (total > 0) {
    const nonPublicRatio = (holdCount + excludeCount) / total;
    if (nonPublicRatio > 0.8)
      blockers.push("audit_non_public_ratio_over_80_percent");

    const proposedChanges =
      report.rollout?.proposed_visibility_changes ?? 0;
    if (
      !Number.isInteger(proposedChanges) ||
      proposedChanges < 0 ||
      proposedChanges > total
    )
      blockers.push("audit_visibility_delta_invalid");
    else if (proposedChanges / total > 0.8)
      blockers.push("audit_visibility_delta_over_80_percent");
  }

  const exactLinks = report.by_official_link_quality?.EVENT_OFFICIAL_LINK ?? 0;
  const sourceOnly =
    report.by_official_link_quality?.FIRST_PARTY_SOURCE_ONLY ?? 0;
  const tourApiOnly = report.by_official_link_quality?.TOURAPI_ONLY ?? 0;
  const missing = report.by_official_link_quality?.MISSING ?? 0;
  const riskyPublic =
    (report.by_public_quality_risk?.PUBLIC_SPARSE ?? 0) +
    (report.by_public_quality_risk?.PUBLIC_OFFICIAL_LINK_GAP ?? 0) +
    (report.by_public_quality_risk?.PUBLIC_SPARSE_AND_LINK_GAP ?? 0);

  if (tourApiOnly + missing > 0)
    warnings.push(`official_event_link_gap=${tourApiOnly + missing}`);
  if (sourceOnly > 0)
    warnings.push(`first_party_source_only=${sourceOnly}`);
  if (riskyPublic > 0) warnings.push(`public_quality_risk=${riskyPublic}`);
  if (exactLinks === 0) warnings.push("event_official_link_zero");
  if ((report.rollout?.legacy_unversioned ?? 0) > 0)
    warnings.push(
      `legacy_unversioned=${report.rollout?.legacy_unversioned ?? 0}`,
    );
  if ((report.rollout?.proposed_visibility_changes ?? 0) > 0)
    warnings.push(
      `proposed_visibility_changes=${report.rollout?.proposed_visibility_changes ?? 0}`,
    );

  return { ok: blockers.length === 0, blockers, warnings };
}
