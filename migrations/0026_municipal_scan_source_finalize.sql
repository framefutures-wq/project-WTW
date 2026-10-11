-- Preserves source-wide candidate selection and a durable continuous scan cursor.
ALTER TABLE municipal_scan_jobs ADD COLUMN source_finalized_at TEXT;
ALTER TABLE municipal_scan_jobs ADD COLUMN observed_identities_json TEXT;
ALTER TABLE municipal_detail_jobs ADD COLUMN retry_stage TEXT
  CHECK(retry_stage IS NULL OR retry_stage IN ('FETCH_PENDING','PARSE_PENDING','PERSIST_PENDING'));

CREATE INDEX IF NOT EXISTS idx_municipal_scan_source_finalize_ready
  ON municipal_scan_jobs(operating_date, source_key, page_index, stage, source_finalized_at, available_at);

CREATE TABLE IF NOT EXISTS municipal_scan_cycles (
  id TEXT PRIMARY KEY,
  operating_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','WAITING','DONE')),
  source_cursor INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL,
  lease_until TEXT,
  seed_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_category TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_municipal_scan_cycles_active
  ON municipal_scan_cycles(status, created_at);
