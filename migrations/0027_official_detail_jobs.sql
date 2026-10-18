-- Dormant official-detail recovery checkpoints. Production activation is a separate gate.
CREATE TABLE IF NOT EXISTS official_detail_jobs (
  event_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 1,
  candidate_json TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('FETCH_PENDING','READER_PENDING','PARSE_PENDING','POSTER_PENDING','PERSIST_PENDING','DONE','RETRY')),
  retry_stage TEXT CHECK (retry_stage IS NULL OR retry_stage IN ('FETCH_PENDING','READER_PENDING','PARSE_PENDING','POSTER_PENDING','PERSIST_PENDING')),
  raw_html TEXT,
  raw_html_sha256 TEXT,
  final_url TEXT,
  normalized_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  retry_at TEXT,
  safe_error_category TEXT,
  lease_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_official_detail_jobs_ready
  ON official_detail_jobs(stage, available_at, expires_at, event_id);
