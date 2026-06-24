// ============================================================
// SQLite via sql.js (WebAssembly) — server-only.
// No native compilation; the database is held in memory and the
// file is written back (debounced) on every mutation. Same SQLite
// file format, so the data is portable to other SQLite tooling.
// ============================================================
import "server-only";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { getDbPath } from "@/lib/config/env";
import { SCHEMA_SQL } from "./schema";

let dbPromise: Promise<Database> | null = null;
let dbInstance: Database | null = null;
let saveTimer: NodeJS.Timeout | null = null;

async function init(): Promise<Database> {
  // sql.js is an external package, so its default loader finds the
  // bundled sql-wasm.wasm relative to its own dist dir — no locateFile needed.
  const SQL = await initSqlJs();
  const file = getDbPath();
  const data = existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
  const db = new SQL.Database(data);
  // exec() handles multi-statement SQL; run() only executes the first statement.
  db.exec(SCHEMA_SQL);
  try {
    db.run("ALTER TABLE chats ADD COLUMN parent_id TEXT;");
  } catch {
    // Ignore duplicate column errors
  }
  try {
    db.run("ALTER TABLE chats ADD COLUMN type TEXT NOT NULL DEFAULT 'chat';");
  } catch {
    // Ignore duplicate column errors
  }
  try {
    db.run("ALTER TABLE chats ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;");
  } catch {
    // Ignore duplicate column errors
  }
  try {
    db.run("ALTER TABLE chats ADD COLUMN workspace_path TEXT;");
  } catch {
    // Ignore duplicate column errors
  }
  try {
    db.run("UPDATE chats SET workspace_path = (SELECT path FROM projects WHERE projects.id = chats.project_id) WHERE workspace_path IS NULL AND project_id IS NOT NULL;");
  } catch {
    // Best-effort backfill for existing project chats
  }
  // Create project indexes after migrations; older databases may not have project_id yet.
  try {
    db.run("CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id, updated_at);");
  } catch {
    // Ignore if already exists
  }
  dbInstance = db;
  return db;
}

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (!dbPromise) dbPromise = init();
  return dbPromise;
}

/** Persist the in-memory DB to disk atomically (debounced). */
function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dbInstance) return;
    try {
      const file = getDbPath();
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, Buffer.from(dbInstance.export()));
      renameSync(tmp, file);
    } catch {
      // Persistence is best-effort; the in-memory DB stays correct.
    }
  }, 150);
}

// ── Query helpers (positional ? params) ─────────────────────
export async function all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
  const db = await getDb();
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export async function get<T>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: SqlValue[] = []): Promise<void> {
  const db = await getDb();
  db.run(sql, params);
  schedulePersist();
}
