-- Separate, reproducible audit-derived snapshot. No event or source writes.
CREATE TABLE event_trust_status (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  audit_id TEXT REFERENCES official_source_audits(id),
  trust_status TEXT NOT NULL CHECK(trust_status IN ('confirmed','needs_review','changed')),
  status_reason TEXT NOT NULL,
  evidence_source_id TEXT REFERENCES official_source_links(id),
  checked_at TEXT,
  evaluated_at TEXT NOT NULL,
  decision_method TEXT NOT NULL CHECK(decision_method IN ('automatic','automatic_with_review')),
  rule_version TEXT NOT NULL,
  changed_fields TEXT NOT NULL CHECK(json_valid(changed_fields) AND json_type(changed_fields)='array'),
  unconfirmed_fields TEXT NOT NULL CHECK(json_valid(unconfirmed_fields) AND json_type(unconfirmed_fields)='array'),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json) AND json_type(evidence_json)='array'),
  requires_review INTEGER NOT NULL CHECK(requires_review IN (0,1)),
  access_failure INTEGER NOT NULL CHECK(access_failure IN (0,1)),
  mismatch_candidate INTEGER NOT NULL CHECK(mismatch_candidate IN (0,1)),
  CHECK(trust_status='needs_review' OR (audit_id IS NOT NULL AND evidence_source_id IS NOT NULL AND checked_at IS NOT NULL)),
  CHECK(trust_status!='changed' OR json_array_length(changed_fields)>0)
);
CREATE INDEX idx_event_trust_status ON event_trust_status(trust_status);
