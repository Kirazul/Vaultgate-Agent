// Schema as a module constant so it is bundled with the server
// (the .sql file is kept alongside as human-readable reference).
export const SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  chat_id        TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  content        TEXT NOT NULL DEFAULT '',
  blocks         TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'complete',
  model          TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at, id);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;
