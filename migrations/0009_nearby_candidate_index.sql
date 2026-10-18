CREATE INDEX IF NOT EXISTS idx_events_nearby_candidates ON events(is_sample, verification, lat, lng, id);
