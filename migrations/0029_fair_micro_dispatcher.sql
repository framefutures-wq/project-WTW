-- Durable, singleton coordination state for the dormant fair micro dispatcher.
CREATE TABLE IF NOT EXISTS fair_micro_dispatcher_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  lease_token TEXT,
  lease_until TEXT,
  dispatch_count INTEGER NOT NULL DEFAULT 0,
  cursor INTEGER NOT NULL DEFAULT 0,
  municipal_last_dispatch INTEGER NOT NULL DEFAULT -1,
  official_last_dispatch INTEGER NOT NULL DEFAULT -1,
  tourapi_last_dispatch INTEGER NOT NULL DEFAULT -1,
  last_lane TEXT CHECK(last_lane IS NULL OR last_lane IN ('municipal','official','tourapi')),
  last_stage TEXT,
  last_status TEXT,
  last_error_category TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO fair_micro_dispatcher_state(id,updated_at) VALUES(1,'1970-01-01T00:00:00.000Z');
