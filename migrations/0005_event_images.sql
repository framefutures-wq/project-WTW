CREATE TABLE IF NOT EXISTS event_images (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  image_url TEXT,
  source_type TEXT,
  source_page_url TEXT,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  image_status TEXT NOT NULL CHECK (image_status IN ('ok', 'missing', 'blocked', 'invalid')),
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  last_checked_at TEXT NOT NULL,
  evidence_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_images_status ON event_images(image_status);
