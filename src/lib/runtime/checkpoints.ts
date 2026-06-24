import "server-only";
import path from "node:path";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { getDataDir } from "@/lib/config/env";
import { defaultWorkspaceRoot, sanitizeChatId } from "./paths";
import { resolvedRoot } from "./resolved-roots";
import { stopWorkspaceProcesses } from "./workspace";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vaultgate"]);
const SKIP_FILES = new Set(["dev.log"]);

interface CheckpointManifest {
  chatId: string;
  messageId: string;
  createdAt: number;
  workspaceExisted: boolean;
  workspaceIncluded: boolean;
  savedAt: string;
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(/* turbopackIgnore: true */ a);
  const right = path.resolve(/* turbopackIgnore: true */ b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function canCheckpointWorkspace(root: string): boolean {
  return !samePath(root, defaultWorkspaceRoot());
}

function safeMessageId(messageId: string): string {
  return String(messageId || "checkpoint").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160) || "checkpoint";
}

function checkpointRoot(chatId: string): string {
  return path.join(/* turbopackIgnore: true */ getDataDir(), "checkpoints", sanitizeChatId(chatId));
}

function checkpointDir(chatId: string, messageId: string): string {
  return path.join(/* turbopackIgnore: true */ checkpointRoot(chatId), safeMessageId(messageId));
}

function shouldSkip(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  if (!rel) return false;
  const parts = rel.split(path.sep).filter(Boolean);
  return parts.some((part) => SKIP_DIRS.has(part)) || SKIP_FILES.has(path.basename(file));
}

function copyWorkspaceFiles(root: string, dest: string): void {
  if (!existsSync(root)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const from = path.join(/* turbopackIgnore: true */ root, entry.name);
    if (shouldSkip(root, from)) continue;
    cpSync(from, path.join(/* turbopackIgnore: true */ dest, entry.name), {
      recursive: true,
      force: true,
      filter: (src) => !shouldSkip(root, src),
    });
  }
}

function clearWorkspaceFiles(root: string): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(/* turbopackIgnore: true */ root, entry.name);
    if (SKIP_DIRS.has(entry.name)) continue;
    rmSync(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}

function restoreFiles(from: string, root: string): void {
  if (!existsSync(from)) return;
  mkdirSync(root, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    cpSync(path.join(/* turbopackIgnore: true */ from, entry.name), path.join(/* turbopackIgnore: true */ root, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

export function createWorkspaceCheckpoint(chatId: string, messageId: string, createdAt: number): CheckpointManifest {
  const root = resolvedRoot(chatId);
  const dir = checkpointDir(chatId, messageId);
  const workspaceIncluded = canCheckpointWorkspace(root);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const manifest: CheckpointManifest = {
    chatId,
    messageId,
    createdAt,
    workspaceExisted: existsSync(root),
    workspaceIncluded,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(/* turbopackIgnore: true */ dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  if (workspaceIncluded) copyWorkspaceFiles(root, path.join(/* turbopackIgnore: true */ dir, "files"));
  return manifest;
}

export function restoreWorkspaceCheckpoint(chatId: string, messageId: string): CheckpointManifest {
  const dir = checkpointDir(chatId, messageId);
  const manifestFile = path.join(/* turbopackIgnore: true */ dir, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error("No checkpoint exists for this message.");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as CheckpointManifest;
  const root = resolvedRoot(chatId);

  stopWorkspaceProcesses(chatId);
  if (!manifest.workspaceIncluded) return manifest;
  mkdirSync(root, { recursive: true });
  clearWorkspaceFiles(root);
  if (manifest.workspaceExisted) restoreFiles(path.join(/* turbopackIgnore: true */ dir, "files"), root);
  return manifest;
}
