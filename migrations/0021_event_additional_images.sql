CREATE TABLE IF NOT EXISTS event_additional_images (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL CHECK(image_url LIKE 'https://%'),
  source_type TEXT,
  source_page_url TEXT,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 2),
  image_status TEXT NOT NULL CHECK(image_status IN ('ok','missing','blocked','invalid')),
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  last_checked_at TEXT NOT NULL,
  evidence_note TEXT,
  PRIMARY KEY(event_id, image_url),
  UNIQUE(event_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_event_additional_images_event_status
  ON event_additional_images(event_id, image_status, sort_order);
