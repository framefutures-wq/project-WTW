CREATE TABLE tourapi_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  content_id TEXT,
  title TEXT,
  raw_payload TEXT NOT NULL CHECK(json_valid(raw_payload)),
  reason TEXT NOT NULL,
  rejected_at TEXT NOT NULL
);
CREATE INDEX idx_tourapi_rejections_run ON tourapi_rejections(sync_run_id, id);
CREATE INDEX idx_tourapi_rejections_content ON tourapi_rejections(content_id, rejected_at);
