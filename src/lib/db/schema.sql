-- VaultGate local database schema.
-- Applied idempotently on boot; bump PRAGMA user_version for migrations.

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'New Chat',
  model       TEXT NOT NULL DEFAULT '',
  parent_id   TEXT,
  type        TEXT NOT NULL DEFAULT 'chat',
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  workspace_path TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  chat_id        TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  content        TEXT NOT NULL DEFAULT '',
  blocks         TEXT NOT NULL DEFAULT '[]',   -- JSON ContentBlock[]
  status         TEXT NOT NULL DEFAULT 'complete',
  model          TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at, id);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
