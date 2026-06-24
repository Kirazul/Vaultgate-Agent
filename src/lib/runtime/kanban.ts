// ============================================================
// Persistent Kanban board (server-only) — per-chat, durable across turns.
//
// Uses a single action-based Kanban tool over the same board, so the model has a
// single mental model. The board is a JSON file under
// the chat workspace, so a plan survives context compaction, app
// restarts, and multi-session work — unlike the ephemeral TodoWrite list.
// ============================================================
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { workspaceMetaPath } from "@/lib/runtime/paths";

export type CardStatus = "todo" | "doing" | "done" | "blocked";
export type CardPriority = "high" | "medium" | "low";

const STATUSES: CardStatus[] = ["todo", "doing", "done", "blocked"];

export interface KanbanCard {
  id: string;
  title: string;
  body: string;
  status: CardStatus;
  priority: CardPriority;
  comments: string[];
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
}

interface Board {
  cards: KanbanCard[];
  seq: number;
}

function boardPath(chatId: string): string {
  const dir = workspaceMetaPath(chatId);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "kanban.json");
}

function load(chatId: string): Board {
  const file = boardPath(chatId);
  if (!existsSync(file)) return { cards: [], seq: 0 };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<Board>;
    return { cards: Array.isArray(parsed.cards) ? parsed.cards : [], seq: typeof parsed.seq === "number" ? parsed.seq : 0 };
  } catch {
    return { cards: [], seq: 0 };
  }
}

function save(chatId: string, board: Board): void {
  const file = boardPath(chatId);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(board, null, 2), "utf-8");
  renameSync(tmp, file);
}

function normalizeStatus(value: unknown): CardStatus | undefined {
  return STATUSES.includes(value as CardStatus) ? (value as CardStatus) : undefined;
}

function normalizePriority(value: unknown): CardPriority {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function findCard(board: Board, id: string): KanbanCard | undefined {
  const needle = id.trim();
  return board.cards.find((c) => c.id === needle || c.id === `c${needle.replace(/^c/, "")}`);
}

export function createCard(chatId: string, title: string, opts: { body?: unknown; status?: unknown; priority?: unknown } = {}): KanbanCard {
  const board = load(chatId);
  const now = Date.now();
  board.seq += 1;
  const card: KanbanCard = {
    id: `c${board.seq}`,
    title: title.trim().slice(0, 300),
    body: String(opts.body ?? "").trim().slice(0, 4000),
    status: normalizeStatus(opts.status) ?? "todo",
    priority: normalizePriority(opts.priority),
    comments: [],
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
  };
  board.cards.push(card);
  save(chatId, board);
  return card;
}

export function updateCard(
  chatId: string,
  id: string,
  patch: { title?: string; body?: string; status?: unknown; priority?: unknown },
): { ok: boolean; card?: KanbanCard; error?: string } {
  const board = load(chatId);
  const card = findCard(board, id);
  if (!card) return { ok: false, error: `No card with id "${id}". Use action=list to see card ids.` };
  if (patch.title !== undefined) card.title = patch.title.trim().slice(0, 300);
  if (patch.body !== undefined) card.body = patch.body.trim().slice(0, 4000);
  if (patch.status !== undefined) {
    const status = normalizeStatus(patch.status);
    if (!status) return { ok: false, error: `Invalid status. Use one of: ${STATUSES.join(", ")}.` };
    card.status = status;
  }
  if (patch.priority !== undefined) card.priority = normalizePriority(patch.priority);
  card.updatedAt = Date.now();
  save(chatId, board);
  return { ok: true, card };
}

export function commentCard(chatId: string, id: string, comment: string): { ok: boolean; card?: KanbanCard; error?: string } {
  const board = load(chatId);
  const card = findCard(board, id);
  if (!card) return { ok: false, error: `No card with id "${id}".` };
  card.comments.push(comment.trim().slice(0, 2000));
  card.updatedAt = Date.now();
  save(chatId, board);
  return { ok: true, card };
}

export function linkCard(chatId: string, id: string, blockedBy: string[]): { ok: boolean; card?: KanbanCard; error?: string } {
  const board = load(chatId);
  const card = findCard(board, id);
  if (!card) return { ok: false, error: `No card with id "${id}".` };
  const valid = blockedBy.map((b) => b.trim()).filter((b) => b && b !== card.id && findCard(board, b));
  card.blockedBy = [...new Set([...card.blockedBy, ...valid])];
  if (card.blockedBy.length && card.status !== "done") card.status = "blocked";
  card.updatedAt = Date.now();
  save(chatId, board);
  return { ok: true, card };
}

export function deleteCard(chatId: string, id: string): { ok: boolean; error?: string } {
  const board = load(chatId);
  const card = findCard(board, id);
  if (!card) return { ok: false, error: `No card with id "${id}".` };
  board.cards = board.cards.filter((c) => c.id !== card.id);
  for (const c of board.cards) c.blockedBy = c.blockedBy.filter((b) => b !== card.id);
  save(chatId, board);
  return { ok: true };
}

export function listCards(chatId: string, status?: unknown): KanbanCard[] {
  const board = load(chatId);
  const wanted = normalizeStatus(status);
  const cards = wanted ? board.cards.filter((c) => c.status === wanted) : board.cards;
  const order: Record<CardStatus, number> = { doing: 0, blocked: 1, todo: 2, done: 3 };
  const prio: Record<CardPriority, number> = { high: 0, medium: 1, low: 2 };
  return cards.slice().sort((a, b) => order[a.status] - order[b.status] || prio[a.priority] - prio[b.priority] || a.createdAt - b.createdAt);
}

export function getCard(chatId: string, id: string): KanbanCard | undefined {
  return findCard(load(chatId), id);
}

function statusGlyph(status: CardStatus): string {
  return status === "done" ? "✓" : status === "doing" ? "▸" : status === "blocked" ? "⛔" : "○";
}

export function formatBoard(cards: KanbanCard[]): string {
  if (!cards.length) return "The board is empty. Create cards with Kanban action=create.";
  const byStatus = (s: CardStatus) => cards.filter((c) => c.status === s);
  const section = (label: string, s: CardStatus) => {
    const rows = byStatus(s);
    if (!rows.length) return "";
    const lines = rows.map((c) => {
      const blocked = c.blockedBy.length ? ` (blocked by ${c.blockedBy.join(", ")})` : "";
      return `  ${statusGlyph(c.status)} ${c.id} [${c.priority}] ${c.title}${blocked}`;
    });
    return `${label}:\n${lines.join("\n")}`;
  };
  const done = byStatus("done").length;
  return [
    `Board: ${cards.length} card${cards.length === 1 ? "" : "s"}, ${done} done.`,
    section("Doing", "doing"),
    section("Blocked", "blocked"),
    section("Todo", "todo"),
    section("Done", "done"),
  ].filter(Boolean).join("\n");
}

export function formatCard(card: KanbanCard): string {
  const lines = [
    `${statusGlyph(card.status)} ${card.id} — ${card.title}`,
    `status: ${card.status} | priority: ${card.priority}`,
  ];
  if (card.body) lines.push(`details: ${card.body}`);
  if (card.blockedBy.length) lines.push(`blocked by: ${card.blockedBy.join(", ")}`);
  if (card.comments.length) lines.push(`comments:\n${card.comments.map((c) => `  - ${c}`).join("\n")}`);
  return lines.join("\n");
}
