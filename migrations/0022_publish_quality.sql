ALTER TABLE events ADD COLUMN publish_quality_state TEXT NOT NULL DEFAULT 'PUBLIC'
  CHECK(publish_quality_state IN ('PUBLIC','HOLD','EXCLUDE'));

ALTER TABLE events ADD COLUMN publish_quality_reason TEXT;

ALTER TABLE events ADD COLUMN publish_quality_rule_version TEXT;

ALTER TABLE events ADD COLUMN publish_quality_checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_events_publish_quality
  ON events(publish_quality_state, is_sample, verification, start_date, end_date);
