CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT
);

CREATE TABLE push_preferences (
  subscription_id TEXT PRIMARY KEY REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  region TEXT,
  audience TEXT,
  theme TEXT,
  new_event INTEGER NOT NULL DEFAULT 1 CHECK (new_event IN (0,1)),
  schedule_changed INTEGER NOT NULL DEFAULT 1 CHECK (schedule_changed IN (0,1)),
  cancelled_or_postponed INTEGER NOT NULL DEFAULT 1 CHECK (cancelled_or_postponed IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE push_deliveries (
  alert_id TEXT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('pending','delivered','retry','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  delivered_at TEXT,
  last_http_status INTEGER,
  PRIMARY KEY (alert_id, subscription_id)
);

CREATE INDEX idx_push_subscriptions_disabled ON push_subscriptions(disabled_at);
CREATE INDEX idx_push_deliveries_state_next ON push_deliveries(state, next_attempt_at);
