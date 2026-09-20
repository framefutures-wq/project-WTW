CREATE TABLE municipal_candidate_state (
  candidate_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  decision_state TEXT NOT NULL CHECK(decision_state IN ('AUTO_PUBLISH','AUTO_RETRY','AUTO_EXCLUDE','POLICY_SKIP','EXPIRED')),
  decision_reason TEXT NOT NULL,
  retry_until TEXT,
  last_payload_hash TEXT NOT NULL
);
CREATE INDEX idx_municipal_candidate_retry ON municipal_candidate_state(decision_state,retry_until,source_key);
