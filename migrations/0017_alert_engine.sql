CREATE TABLE alert_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('NEW_EVENT','SCHEDULE_CHANGED','CANCELLED_OR_POSTPONED')),
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  effective_at TEXT,
  before_json TEXT,
  after_json TEXT,
  source_id TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','delivered','suppressed'))
);

CREATE INDEX idx_alert_events_event_created ON alert_events(event_id, created_at);
