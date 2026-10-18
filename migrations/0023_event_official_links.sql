CREATE TABLE IF NOT EXISTS event_official_links (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL CHECK(url LIKE 'https://%'),
  checked_at TEXT NOT NULL,
  PRIMARY KEY(event_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_event_official_links_lookup
  ON event_official_links(event_id, checked_at DESC);
