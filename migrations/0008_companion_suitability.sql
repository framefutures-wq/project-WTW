CREATE TABLE IF NOT EXISTS event_companion_suitability (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  companion_type TEXT NOT NULL CHECK(companion_type IN ('child','couple','parents','pet')),
  suitability_state TEXT NOT NULL CHECK(suitability_state IN ('fit','allowed','conditional','unknown','not_allowed')),
  classifier_type TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  positive_reason_codes TEXT NOT NULL CHECK(json_valid(positive_reason_codes) AND json_type(positive_reason_codes)='array'),
  caution_reason_codes TEXT NOT NULL CHECK(json_valid(caution_reason_codes) AND json_type(caution_reason_codes)='array'),
  source_fact_tags TEXT NOT NULL CHECK(json_valid(source_fact_tags) AND json_type(source_fact_tags)='array'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(event_id, companion_type)
);
CREATE INDEX IF NOT EXISTS idx_companion_filter ON event_companion_suitability(companion_type, suitability_state, event_id);
