-- Dormant, one-endpoint TourAPI detail checkpoints. Scheduler activation is separate.
CREATE TABLE IF NOT EXISTS tourapi_detail_jobs (
  event_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 1,
  candidate_json TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('FETCH_COMMON','FETCH_INTRO','FETCH_INFO','PERSIST_ONE','RETRY','DONE')),
  retry_stage TEXT CHECK(retry_stage IS NULL OR retry_stage IN ('FETCH_COMMON','FETCH_INTRO','FETCH_INFO','PERSIST_ONE')),
  checkpoint_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  retry_at TEXT,
  safe_error_category TEXT,
  lease_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tourapi_detail_jobs_ready
  ON tourapi_detail_jobs(stage, available_at, expires_at, event_id);
