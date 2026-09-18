PRAGMA foreign_keys = ON;
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('organizer','municipality','tourapi','public_data','sample')),
  priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 5),
  name TEXT NOT NULL, url TEXT,
  fetched_at TEXT NOT NULL, raw_payload TEXT,
  CHECK((kind='organizer' AND priority=1) OR (kind='municipality' AND priority=2) OR (kind='tourapi' AND priority=3) OR (kind='public_data' AND priority=4) OR (kind='sample' AND priority=5)),
  CHECK(kind='sample' OR (url IS NOT NULL AND url LIKE 'https://%'))
);
CREATE TABLE events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
  region TEXT NOT NULL, venue TEXT NOT NULL, address TEXT NOT NULL,
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK(end_date >= start_date),
  lat REAL CHECK(lat BETWEEN -90 AND 90), lng REAL CHECK(lng BETWEEN -180 AND 180),
  cost TEXT NOT NULL DEFAULT 'unknown' CHECK(cost IN ('free','paid','unknown')),
  price_text TEXT, pet_policy TEXT NOT NULL DEFAULT 'unknown' CHECK(pet_policy IN ('allowed','prohibited','unknown')),
  status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('scheduled','cancelled','postponed','unknown')),
  verification TEXT NOT NULL DEFAULT 'pending' CHECK(verification IN ('pending','verified','stale','sample')),
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),
  primary_source_id TEXT REFERENCES sources(id), checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK((is_sample=1 AND verification='sample') OR (is_sample=0 AND verification!='sample')),
  CHECK((lat IS NULL) = (lng IS NULL)),
  CHECK(verification!='verified' OR (primary_source_id IS NOT NULL AND checked_at IS NOT NULL))
);
CREATE TABLE event_tags (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK(tag IN ('kids','couple','parents','pets','food','fireworks','flowers','experience','performance')),
  PRIMARY KEY(event_id, tag)
);
CREATE TABLE event_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  field TEXT NOT NULL CHECK(field IN ('schedule','venue','price','status','pet_policy','coordinates','kids','couple','parents','pets','food','fireworks','flowers','experience','performance')),
  excerpt TEXT NOT NULL, checked_at TEXT NOT NULL,
  UNIQUE(event_id, source_id, field)
);
CREATE TABLE event_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason TEXT NOT NULL, before_json TEXT, after_json TEXT
);
CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','success','skipped','failed')),
  provider TEXT NOT NULL, message TEXT, stale_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_events_discovery ON events(is_sample, verification, status, region, start_date, end_date);
CREATE INDEX idx_events_freshness ON events(checked_at);
CREATE INDEX idx_tags_filter ON event_tags(tag,event_id);
CREATE INDEX idx_evidence_field ON event_evidence(event_id,field,checked_at);
