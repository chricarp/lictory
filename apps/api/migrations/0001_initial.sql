CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  original_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending_upload', 'uploaded', 'queued', 'processing', 'completed', 'failed')
  ),
  upload_token TEXT,
  ai_result TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX media_assets_user_created_idx
  ON media_assets (user_id, created_at DESC);

CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

CREATE TABLE triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('time', 'location')),
  status TEXT NOT NULL CHECK (status IN ('active', 'triggered', 'cancelled')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_for TEXT,
  timezone TEXT,
  location_label TEXT,
  latitude REAL,
  longitude REAL,
  radius_meters INTEGER,
  location_event TEXT CHECK (location_event IN ('enter', 'exit')),
  created_at TEXT NOT NULL,
  triggered_at TEXT
);

CREATE INDEX triggers_user_status_idx ON triggers (user_id, status);
CREATE INDEX triggers_scheduled_idx ON triggers (scheduled_for, status);

CREATE TABLE location_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trigger_id TEXT,
  event TEXT NOT NULL CHECK (event IN ('enter', 'exit')),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  FOREIGN KEY (trigger_id) REFERENCES triggers(id) ON DELETE SET NULL
);

CREATE INDEX location_events_user_received_idx
  ON location_events (user_id, received_at DESC);

