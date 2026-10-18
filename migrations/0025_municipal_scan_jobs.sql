CREATE TABLE IF NOT EXISTS municipal_scan_jobs (
  id TEXT PRIMARY KEY,
  operating_date TEXT NOT NULL,
  source_key TEXT NOT NULL,
  page_url TEXT NOT NULL,
  page_identity TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('LIST_PENDING','CANDIDATE_PENDING','DONE','RETRY')),
  retry_stage TEXT CHECK(retry_stage IS NULL OR retry_stage IN ('LIST_PENDING','CANDIDATE_PENDING')),
  candidate_batch_json TEXT,
  candidate_cursor INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  retry_at TEXT,
  safe_error_category TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(operating_date, source_key, page_identity)
);

CREATE INDEX IF NOT EXISTS idx_municipal_scan_jobs_ready
  ON municipal_scan_jobs(stage, available_at, expires_at, operating_date, source_key, page_index);
