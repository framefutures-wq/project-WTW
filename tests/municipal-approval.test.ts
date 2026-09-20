import assert from "node:assert/strict";
import test from "node:test";
import { approvalCandidates, manifestFingerprint, stableMunicipalCandidateId, validateApproval } from "../shared/municipal-approval";
const base = (id: string, gate: "MAIN" | "NEARBY_ONLY" = "MAIN", duplicate = "NEW", ready = true) => ({ candidate_id: id, title: id, start_date: "2026-10-01", end_date: "2026-10-01", venue: "공원", official_url: "https://official.example/event", selection_gate: gate, duplicate_status: duplicate, ready_for_review: ready });
test("approval list admits only MAIN NEW ready candidates with stable municipal IDs", () => {
  const rows = [base("municipal-paju-1-2026"), base("municipal-paju-2-2026", "NEARBY_ONLY"), base("municipal-paju-3-2026", "MAIN", "DUPLICATE")];
  assert.deepEqual(approvalCandidates(rows).map((row) => row.candidate_id), ["municipal-paju-1-2026"]);
  assert.equal(stableMunicipalCandidateId("paju", "940", "2026-09-19"), "municipal-paju-940-2026");
});
test("approval requires a current fingerprint, explicit eligible IDs, and a three-event cap", () => {
  const rows = [base("municipal-paju-1-2026"), base("municipal-paju-2-2026"), base("municipal-paju-3-2026"), base("municipal-paju-4-2026")], fingerprint = manifestFingerprint(rows);
  assert.equal(validateApproval(rows, fingerprint, fingerprint, [rows[0].candidate_id]).length, 1);
  assert.throws(() => validateApproval(rows, fingerprint, "stale", [rows[0].candidate_id]), /stale/);
  assert.throws(() => validateApproval(rows, fingerprint, fingerprint, []), /required/);
  assert.throws(() => validateApproval(rows, fingerprint, fingerprint, ["all"]), /explicit/);
  assert.throws(() => validateApproval(rows, fingerprint, fingerprint, ["missing"]), /missing/);
  assert.throws(() => validateApproval(rows, fingerprint, fingerprint, rows.map((row) => row.candidate_id)), /at most 3/);
});
