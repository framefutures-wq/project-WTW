CREATE TABLE IF NOT EXISTS municipal_detail_jobs (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  official_url TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('FETCH_PENDING','PARSE_PENDING','PERSIST_PENDING','DONE','RETRY')),
  raw_html TEXT,
  raw_html_sha256 TEXT,
  normalized_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  retry_at TEXT,
  safe_error_category TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(source_key, candidate_id, official_url)
);

CREATE INDEX IF NOT EXISTS idx_municipal_detail_jobs_ready
  ON municipal_detail_jobs(stage, available_at, expires_at, id);
