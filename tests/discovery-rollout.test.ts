import assert from "node:assert/strict";
import test from "node:test";
import { validateDiscoveryRolloutAudit } from "../shared/discovery-rollout";

test("discovery rollout accepts a complete read-only production audit", () => {
  const result = validateDiscoveryRolloutAudit({
    mode: "remote-production-read-only",
    writes: 0,
    scanned_current_or_future_verified_events: 100,
    by_state: { PUBLIC: 70, HOLD: 20, EXCLUDE: 10 },
    by_official_link_quality: {
      EVENT_OFFICIAL_LINK: 30,
      FIRST_PARTY_SOURCE_ONLY: 20,
      TOURAPI_ONLY: 45,
      MISSING: 5,
    },
    by_public_quality_risk: {
      NONE: 80,
      PUBLIC_SPARSE: 5,
      PUBLIC_OFFICIAL_LINK_GAP: 10,
      PUBLIC_SPARSE_AND_LINK_GAP: 5,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert(result.warnings.includes("official_event_link_gap=50"));
  assert(result.warnings.includes("public_quality_risk=20"));
});

test("discovery rollout fails closed on empty, mutating or catastrophic audits", () => {
  const result = validateDiscoveryRolloutAudit({
    mode: "local-read-only",
    writes: 1,
    scanned_current_or_future_verified_events: 10,
    by_state: { PUBLIC: 1, HOLD: 8, EXCLUDE: 1 },
  });
  assert.equal(result.ok, false);
  assert(result.blockers.includes("audit_not_remote_production"));
  assert(result.blockers.includes("audit_writes_not_zero"));
  assert(result.blockers.includes("audit_non_public_ratio_over_80_percent"));
});

test("discovery rollout rejects inconsistent state totals", () => {
  const result = validateDiscoveryRolloutAudit({
    mode: "remote-production-read-only",
    writes: 0,
    scanned_current_or_future_verified_events: 10,
    by_state: { PUBLIC: 8, HOLD: 1, EXCLUDE: 0 },
  });
  assert.equal(result.ok, false);
  assert(result.blockers.includes("audit_state_total_mismatch"));
});
