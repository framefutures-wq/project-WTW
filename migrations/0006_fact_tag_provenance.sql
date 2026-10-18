PRAGMA foreign_keys=OFF;
ALTER TABLE event_tags RENAME TO event_tags_legacy;
CREATE TABLE event_tags (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK(tag IN ('kids','couple','parents','pets','food','fireworks','flowers','experience','performance','flower_garden','exhibition','traditional_history','nature_scenery','night_light','photo_spot','local_specialty','education','sports','parade','children_program','family_program','indoor','shuttle','accessibility','seated_viewing','pet_allowed')),
  classifier_type TEXT NOT NULL DEFAULT 'legacy',
  rule_version TEXT NOT NULL DEFAULT 'legacy',
  rule_id TEXT,
  evidence_source_ref TEXT,
  evidence_field TEXT,
  evidence_excerpt TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(event_id, tag, classifier_type, rule_version)
);
INSERT INTO event_tags(event_id,tag,classifier_type,rule_version)
SELECT event_id,tag,'legacy','legacy' FROM event_tags_legacy;
DROP TABLE event_tags_legacy;
CREATE INDEX idx_tags_filter ON event_tags(tag,event_id);
CREATE INDEX idx_fact_tags_scope ON event_tags(classifier_type,rule_version,event_id);
PRAGMA foreign_keys=ON;
