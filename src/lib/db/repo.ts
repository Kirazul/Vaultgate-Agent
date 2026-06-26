// ============================================================
// Typed async repositories over SQLite (server-only).
// All persistence goes through here — no raw SQL elsewhere.
// ============================================================
import "server-only";
import { all, get, run } from "./client";
import { sanitizeAssistantMessage } from "@/lib/ai/tool-leak-sanitizer";
import { defaultWorkspaceRoot } from "@/lib/runtime/paths";
import type { Chat, ChatWithMessages, ContentBlock, Message, Project, Role } from "@/types";

// ── Projects ───────────────────────────────────────────────
interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
}

function toProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, path: r.path, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function listProjects(): Promise<Project[]> {
  return (await all<ProjectRow>("SELECT * FROM projects ORDER BY updated_at DESC")).map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const row = await get<ProjectRow>("SELECT * FROM projects WHERE id = ?", [id]);
  return row ? toProject(row) : null;
}

export async function getProjectByPath(projectPath: string): Promise<Project | null> {
  const row = await get<ProjectRow>("SELECT * FROM projects WHERE path = ?", [projectPath]);
  return row ? toProject(row) : null;
}

export async function createProject(project: Pick<Project, "id" | "name" | "path">): Promise<Project> {
  const now = Date.now();
  await run(
    `INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path, updated_at = excluded.updated_at`,
    [project.id, project.name, project.path, now, now],
  );
  return { ...project, createdAt: now, updatedAt: now };
}

export async function updateProject(id: string, patch: Partial<Pick<Project, "name" | "path">>): Promise<void> {
  if (patch.name !== undefined) await run("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?", [patch.name, Date.now(), id]);
  if (patch.path !== undefined) await run("UPDATE projects SET path = ?, updated_at = ? WHERE id = ?", [patch.path, Date.now(), id]);
}

export async function deleteProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (project) await run("UPDATE chats SET workspace_path = COALESCE(workspace_path, ?) WHERE project_id = ?", [project.path, id]);
  // Unlink chats from this project (don't delete them)
  await run("UPDATE chats SET project_id = NULL WHERE project_id = ?", [id]);
  await run("DELETE FROM projects WHERE id = ?", [id]);
}

export async function touchProject(id: string): Promise<void> {
  await run("UPDATE projects SET updated_at = ? WHERE id = ?", [Date.now(), id]);
}

// ── Chats ──────────────────────────────────────────────────

interface ChatRow {
  id: string;
  title: string;
  model: string;
  parent_id: string | null;
  type: string;
  project_id: string | null;
  workspace_path: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  blocks: string;
  status: string;
  model: string | null;
  created_at: number;
  duration_ms: number | null;
}

function toChat(r: ChatRow): Chat {
  return {
    id: r.id,
    title: r.title,
    model: r.model,
    parentId: r.parent_id ?? undefined,
    type: r.type,
    projectId: r.project_id ?? undefined,
    workspacePath: r.workspace_path ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMessage(r: MessageRow): Message {
  let blocks: ContentBlock[] = [];
  try {
    blocks = JSON.parse(r.blocks) as ContentBlock[];
  } catch {
    blocks = [];
  }
  return sanitizeAssistantMessage({
    id: r.id,
    chatId: r.chat_id,
    role: r.role as Role,
    content: r.content,
    blocks,
    status: r.status as Message["status"],
    model: r.model ?? undefined,
    createdAt: r.created_at,
    durationMs: r.duration_ms ?? undefined,
  });
}

// ── Chats ───────────────────────────────────────────────────
async function workspacePathForChat(chat: Pick<Chat, "parentId" | "projectId">): Promise<string | null> {
  if (chat.projectId) {
    const project = await getProject(chat.projectId);
    if (project?.path) return project.path;
  }
  if (chat.parentId) {
    const parent = await get<Pick<ChatRow, "workspace_path" | "project_id">>("SELECT workspace_path, project_id FROM chats WHERE id = ?", [chat.parentId]);
    if (parent?.workspace_path) return parent.workspace_path;
    if (parent?.project_id) {
      const project = await getProject(parent.project_id);
      if (project?.path) return project.path;
    }
  }
  return defaultWorkspaceRoot();
}

export async function listChats(): Promise<Chat[]> {
  return (await all<ChatRow>("SELECT * FROM chats WHERE type = 'chat' ORDER BY updated_at DESC")).map(toChat);
}

export async function getChat(id: string): Promise<ChatWithMessages | null> {
  const row = await get<ChatRow>("SELECT * FROM chats WHERE id = ?", [id]);
  if (!row) return null;
  return { ...toChat(row), messages: await listMessages(id) };
}

export async function createChat(chat: Pick<Chat, "id" | "title" | "model" | "parentId" | "type" | "projectId">): Promise<Chat> {
  const now = Date.now();
  const workspacePath = await workspacePathForChat(chat);
  await run(
    `INSERT INTO chats (id, title, model, parent_id, type, project_id, workspace_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
        title = CASE WHEN chats.title = 'New Chat' AND excluded.title <> '' THEN excluded.title ELSE chats.title END,
        model = CASE WHEN chats.model = '' AND excluded.model <> '' THEN excluded.model ELSE chats.model END,
        parent_id = COALESCE(excluded.parent_id, chats.parent_id),
        type = CASE WHEN excluded.type <> '' THEN excluded.type ELSE chats.type END,
        project_id = CASE WHEN NOT EXISTS (SELECT 1 FROM messages WHERE chat_id = chats.id) THEN excluded.project_id ELSE chats.project_id END,
        workspace_path = CASE WHEN NOT EXISTS (SELECT 1 FROM messages WHERE chat_id = chats.id) THEN excluded.workspace_path ELSE chats.workspace_path END,
        updated_at = MAX(chats.updated_at, excluded.updated_at)`,
    [chat.id, chat.title, chat.model, chat.parentId ?? null, chat.type || "chat", chat.projectId ?? null, workspacePath, now, now],
  );
  // Touch the parent project so it sorts to the top.
  if (chat.projectId) void touchProject(chat.projectId);
  return { ...chat, workspacePath: workspacePath ?? undefined, createdAt: now, updatedAt: now };
}

export async function updateChat(id: string, patch: Partial<Pick<Chat, "title" | "model">>): Promise<void> {
  if (patch.title !== undefined) await run("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?", [patch.title, Date.now(), id]);
  if (patch.model !== undefined) await run("UPDATE chats SET model = ?, updated_at = ? WHERE id = ?", [patch.model, Date.now(), id]);
}

export async function updateChatProject(id: string, projectId: string | null): Promise<void> {
  const messageCount = (await get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", [id]))?.n ?? 0;
  if (Number(messageCount) > 0) throw new Error("Chat workspace root is locked after the first message");
  const workspacePath = projectId ? (await getProject(projectId))?.path ?? null : defaultWorkspaceRoot();
  await run("UPDATE chats SET project_id = ?, workspace_path = ?, updated_at = ? WHERE id = ?", [projectId, workspacePath, Date.now(), id]);
}

export async function deleteChat(id: string): Promise<void> {
  const children = await all<{ id: string }>("SELECT id FROM chats WHERE parent_id = ?", [id]);
  const ids = [id, ...children.map((child) => child.id)];
  const placeholders = ids.map(() => "?").join(", ");
  await run(`DELETE FROM messages WHERE chat_id IN (${placeholders})`, ids);
  await run(`DELETE FROM chats WHERE id IN (${placeholders})`, ids);
}

/** List chats scoped to a project (or all if no project filter). */
export async function listChatsForProject(projectId: string): Promise<Chat[]> {
  return (await all<ChatRow>("SELECT * FROM chats WHERE project_id = ? AND type = 'chat' ORDER BY updated_at DESC", [projectId])).map(toChat);
}

// ── Messages ────────────────────────────────────────────────
export async function listMessages(chatId: string): Promise<Message[]> {
  return (await all<MessageRow>("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC", [chatId])).map(toMessage);
}

export async function upsertMessage(m: Message): Promise<void> {
  const message = sanitizeAssistantMessage(m);
  const now = Date.now();
  // Ensure the parent chat exists (foreign key safety).
  await run("INSERT OR IGNORE INTO chats (id, title, model, workspace_path, created_at, updated_at) VALUES (?, 'New Chat', '', ?, ?, ?)", [message.chatId, defaultWorkspaceRoot(), now, now]);
  await run(
    `INSERT INTO messages (id, chat_id, role, content, blocks, status, model, created_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, blocks = excluded.blocks, status = excluded.status, duration_ms = excluded.duration_ms`,
    [message.id, message.chatId, message.role, message.content, JSON.stringify(message.blocks), message.status, message.model ?? null, message.createdAt, message.durationMs ?? null],
  );
  await run("UPDATE chats SET updated_at = ?, model = CASE WHEN model = '' AND ? <> '' THEN ? ELSE model END WHERE id = ?", [now, message.model ?? "", message.model ?? "", message.chatId]);
}

export async function deleteMessagesFrom(chatId: string, createdAt: number): Promise<void> {
  await run("DELETE FROM messages WHERE chat_id = ? AND created_at >= ?", [chatId, createdAt]);
  await run("UPDATE chats SET updated_at = ? WHERE id = ?", [Date.now(), chatId]);
}

export async function deleteMessagesByIds(chatId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await run(`DELETE FROM messages WHERE chat_id = ? AND id IN (${placeholders})`, [chatId, ...ids]);
}

export interface MessageSearchHit {
  chatId: string;
  chatTitle: string;
  role: string;
  content: string;
  createdAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  goal: string;
}

/** Every top-level chat with its message count and opening user message ("goal"),
 * newest first. Reads live state, so chats still streaming are included. */
export async function listChatSummaries(): Promise<ChatSummary[]> {
  const rows = await all<{ id: string; title: string; created_at: number; updated_at: number; message_count: number; goal: string | null }>(
    `SELECT c.id, c.title, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
            (SELECT m2.content FROM messages m2 WHERE m2.chat_id = c.id AND m2.role = 'user' AND m2.content <> ''
               ORDER BY m2.created_at ASC, m2.rowid ASC LIMIT 1) AS goal
       FROM chats c
      WHERE c.type = 'chat'
      ORDER BY c.updated_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: Number(r.message_count) || 0,
    goal: (r.goal ?? "").trim(),
  }));
}

export interface ChatReadResult {
  id: string;
  title: string;
  total: number;
  messages: Array<{ role: string; content: string; createdAt: number }>;
}

/** Read one chat's messages (most recent `limit`), live — works even while that
 * chat is actively streaming, since messages persist as the turn progresses. */
export async function readChat(chatId: string, limit = 40): Promise<ChatReadResult | null> {
  const chat = await get<ChatRow>("SELECT * FROM chats WHERE id = ?", [chatId]);
  if (!chat) return null;
  const total = (await get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", [chatId]))?.n ?? 0;
  const capped = Math.max(1, Math.min(limit, 200));
  const rows = await all<MessageRow>(
    "SELECT * FROM messages WHERE chat_id = ? AND content <> '' ORDER BY created_at DESC, rowid DESC LIMIT ?",
    [chatId, capped],
  );
  return {
    id: chat.id,
    title: chat.title,
    total: Number(total) || 0,
    messages: rows.reverse().map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at })),
  };
}

/** Full-text-ish search over the user's own chat history (top-level chats only). */
export async function searchMessages(query: string, opts: { limit?: number; excludeChatId?: string } = {}): Promise<MessageSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const rows = await all<{ chat_id: string; title: string; role: string; content: string; created_at: number }>(
    `SELECT m.chat_id, c.title, m.role, m.content, m.created_at
       FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE c.type = 'chat' AND m.content LIKE ? ESCAPE '\\' AND m.content <> ''
        ${opts.excludeChatId ? "AND m.chat_id <> ?" : ""}
      ORDER BY m.created_at DESC
      LIMIT ?`,
    opts.excludeChatId ? [like, opts.excludeChatId, limit] : [like, limit],
  );
  return rows.map((r) => ({ chatId: r.chat_id, chatTitle: r.title, role: r.role, content: r.content, createdAt: r.created_at }));
}

// ── Settings (key/value) ────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}
