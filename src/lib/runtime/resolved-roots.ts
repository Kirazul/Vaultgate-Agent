// ============================================================
// In-memory cache of resolved workspace roots (server-only).
// Separated from workspace.ts to avoid circular imports:
// workspace -> background -> execution-runtime -> workspace.
// This module has ZERO runtime imports — it's pure data.
// ============================================================
import "server-only";
import { defaultWorkspaceRoot } from "./paths";
import { existsSync } from "node:fs";

/** chatId → resolved folder path. Populated by resolveWorkspaceRoot (async),
 * read by resolvedRoot (sync) from any runtime module. */
const cache = new Map<string, string>();

/** Set the resolved root for a chat (called by workspace.ts). */
export function setResolvedRoot(chatId: string, root: string): void {
  cache.set(chatId, root);
}

/** Forget a cached root after changing a draft chat's project. */
export function clearResolvedRoot(chatId: string): void {
  cache.delete(chatId);
}

/** Synchronous read of the last resolved workspace root for a chat.
 * Falls back to the shared DEFAULT workspace (a clean, user-facing cwd) — NOT
 * the per-chat state dir, whose only child is the `.vaultgate` meta folder.
 * Falling back to the state dir made a no-project chat's workspace render as
 * "just a .vaultgate folder" before async resolution caught up. */
export function resolvedRoot(chatId: string): string {
  return cache.get(chatId) ?? defaultWorkspaceRoot();
}

/** Check if a resolved workspace exists (sync, uses cache). */
export function resolvedWorkspaceExists(chatId: string): boolean {
  const root = cache.get(chatId);
  if (root) return existsSync(root);
  return existsSync(defaultWorkspaceRoot());
}
