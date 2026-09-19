CREATE INDEX IF NOT EXISTS idx_events_listing_order ON events(is_sample, verification, start_date, id, end_date);
CREATE INDEX IF NOT EXISTS idx_event_tags_classifier_tag_event ON event_tags(classifier_type, tag, event_id);
