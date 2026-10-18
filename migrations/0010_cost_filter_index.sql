CREATE INDEX IF NOT EXISTS idx_events_cost_listing ON events(is_sample, verification, cost, start_date, id, end_date);
