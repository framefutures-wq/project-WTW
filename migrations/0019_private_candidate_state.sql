CREATE TABLE private_candidate_state (
  candidate_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  source_candidate_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  decision_state TEXT NOT NULL CHECK (decision_state IN ('AUTO_PUBLISH','AUTO_RETRY','AUTO_EXCLUDE','POLICY_SKIP','EXPIRED')),
  decision_reason TEXT NOT NULL,
  retry_until TEXT,
  last_payload_hash TEXT NOT NULL,
  title_snapshot TEXT,
  start_date_snapshot TEXT,
  end_date_snapshot TEXT,
  venue_snapshot TEXT,
  official_url_snapshot TEXT,
  identity_stability TEXT NOT NULL CHECK (identity_stability IN ('stable','fallback_unstable')),
  adapter_version TEXT NOT NULL
);

CREATE INDEX idx_private_candidate_retry ON private_candidate_state(decision_state, retry_until);
