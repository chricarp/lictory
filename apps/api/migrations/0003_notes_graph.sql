-- Notes, attachments, normalized entities and the relationships between them.

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  body_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'queued', 'processing', 'ready', 'failed')
  ),
  ai_summary TEXT,
  ai_error TEXT,
  occurred_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX notes_user_created_idx ON notes (user_id, created_at DESC);
CREATE INDEX notes_user_status_idx ON notes (user_id, status);

-- SQLite cannot relax a CHECK constraint in place, so media_assets is rebuilt
-- to gain the 'document' kind plus the note association columns.
CREATE TABLE media_assets_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'document')),
  original_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  duration_seconds REAL,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (
    status IN ('pending_upload', 'uploaded', 'queued', 'processing', 'completed', 'failed')
  ),
  upload_token TEXT,
  ai_result TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO media_assets_v2 (
  id, user_id, note_id, kind, original_name, object_key, content_type,
  byte_size, duration_seconds, position, status, upload_token, ai_result,
  failure_reason, created_at, updated_at
)
SELECT
  id, user_id, NULL, kind, original_name, object_key, content_type,
  byte_size, NULL, 0, status, upload_token, ai_result,
  failure_reason, created_at, updated_at
FROM media_assets;

DROP TABLE media_assets;
ALTER TABLE media_assets_v2 RENAME TO media_assets;

CREATE INDEX media_assets_user_created_idx ON media_assets (user_id, created_at DESC);
CREATE INDEX media_assets_note_idx ON media_assets (note_id, position);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN ('person', 'place', 'time', 'topic', 'organization')
  ),
  name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  description TEXT,
  latitude REAL,
  longitude REAL,
  radius_meters INTEGER,
  address TEXT,
  starts_at TEXT,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT,
  recurrence TEXT,
  color TEXT,
  origin TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX entities_identity_idx
  ON entities (user_id, type, normalized_key);
CREATE INDEX entities_user_type_idx ON entities (user_id, type, name);
CREATE INDEX entities_time_idx ON entities (user_id, starts_at);

CREATE TABLE note_entities (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'mentions' CHECK (
    role IN ('mentions', 'about', 'happens_at', 'located_at', 'with_person')
  ),
  confidence REAL NOT NULL DEFAULT 1,
  origin TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'user')),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (
    status IN ('suggested', 'confirmed', 'rejected')
  ),
  mention TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, entity_id, role)
);

CREATE INDEX note_entities_entity_idx ON note_entities (entity_id, status);
CREATE INDEX note_entities_note_idx ON note_entities (note_id, status);

CREATE TABLE note_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'related' CHECK (
    relation IN ('related', 'follow_up', 'duplicate', 'references')
  ),
  confidence REAL NOT NULL DEFAULT 1,
  origin TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'user')),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (
    status IN ('suggested', 'confirmed', 'rejected')
  ),
  reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (source_note_id <> target_note_id)
);

CREATE UNIQUE INDEX note_links_pair_idx
  ON note_links (source_note_id, target_note_id, relation);
CREATE INDEX note_links_target_idx ON note_links (target_note_id);
CREATE INDEX note_links_user_idx ON note_links (user_id, created_at DESC);

CREATE TABLE note_processing_steps (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (
    stage IN ('transcribe', 'describe', 'extract', 'resolve', 'connect')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'skipped')
  ),
  detail TEXT,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (note_id, stage)
);

CREATE INDEX note_processing_steps_note_idx ON note_processing_steps (note_id);

-- Triggers can now be owned by a note and grounded in an entity.
ALTER TABLE triggers ADD COLUMN note_id TEXT REFERENCES notes(id) ON DELETE CASCADE;
ALTER TABLE triggers ADD COLUMN entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL;

CREATE INDEX triggers_note_idx ON triggers (note_id);
CREATE INDEX triggers_entity_idx ON triggers (entity_id);
