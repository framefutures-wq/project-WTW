import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegacyPublishQualitySql,
  validateLegacyPublishQualityPlan,
  type LegacyPublishQualityRow,
} from "../shared/publish-quality-rollout";
import { PUBLISH_QUALITY_RULE_VERSION } from "../shared/publish-quality";

function row(
  id: string,
  state: "PUBLIC" | "HOLD" | "EXCLUDE" = "PUBLIC",
): LegacyPublishQualityRow {
  return {
    id,
    current_publish_quality_state: "PUBLIC",
    current_publish_quality_rule_version: null,
    proposed: {
      state,
      reason:
        state === "PUBLIC"
          ? "explicit_public_event"
          : state === "HOLD"
            ? "insufficient_event_signal"
            : "explicit_non_event",
      rule_version: PUBLISH_QUALITY_RULE_VERSION,
    },
  };
}

test("legacy rollout allows a small PUBLIC to HOLD transition set", () => {
  const audited = Array.from({ length: 100 }, (_, index) =>
    row(`event-${index}`, index < 7 ? "HOLD" : "PUBLIC"),
  );
  const plan = validateLegacyPublishQualityPlan({
    schema: { publish_quality_columns_present: true },
    scanned_current_or_future_verified_events: 100,
    audited,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.legacyRows.length, 100);
  assert.equal(plan.visibilityChanges, 7);
});

test("legacy rollout blocks destructive or unexpectedly broad first-pass changes", () => {
  const excludePlan = validateLegacyPublishQualityPlan({
    schema: { publish_quality_columns_present: true },
    scanned_current_or_future_verified_events: 2,
    audited: [row("public"), row("exclude", "EXCLUDE")],
  });
  assert.equal(excludePlan.ok, false);
  assert(excludePlan.blockers.includes("legacy_exclude_requires_review"));

  const broad = Array.from({ length: 100 }, (_, index) =>
    row(`event-${index}`, index < 11 ? "HOLD" : "PUBLIC"),
  );
  const broadPlan = validateLegacyPublishQualityPlan({
    schema: { publish_quality_columns_present: true },
    scanned_current_or_future_verified_events: 100,
    audited: broad,
  });
  assert.equal(broadPlan.ok, false);
  assert(
    broadPlan.blockers.includes(
      "legacy_visibility_change_ratio_over_10_percent",
    ),
  );
});

test("legacy rollout requires migrated schema and a complete audit", () => {
  const plan = validateLegacyPublishQualityPlan({
    schema: { publish_quality_columns_present: false },
    scanned_current_or_future_verified_events: 2,
    audited: [row("only-one")],
  });
  assert.equal(plan.ok, false);
  assert(plan.blockers.includes("publish_quality_schema_missing"));
  assert(plan.blockers.includes("audited_rows_incomplete"));
});

test("legacy rollout SQL versions all audited legacy rows and escapes values", () => {
  const sql = buildLegacyPublishQualitySql(
    [row("event-'quoted", "HOLD"), row("event-2", "PUBLIC")],
    "2026-09-27T11:00:00.000Z",
  );
  assert(sql);
  assert.match(sql!, /publish_quality_rule_version = 'publish_quality_v2'/);
  assert.match(sql!, /publish_quality_rule_version IS NULL/);
  assert.match(sql!, /event-''quoted/);
  assert.match(sql!, /THEN 'HOLD'/);
  assert.match(sql!, /THEN 'PUBLIC'/);
});
