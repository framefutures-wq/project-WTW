CREATE TABLE tourapi_detail_state (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  content_id TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('success','empty','failed')),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
  next_retry_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_tourapi_detail_candidate
  ON tourapi_detail_state(last_success_at, next_retry_at, event_id);
