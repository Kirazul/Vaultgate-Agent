// Workspace lifecycle (server-only): create / status / release.
// When a chat belongs to a project, the workspace root IS the project folder.
// VaultGate runtime state is per-chat under app data; selected workspace roots
// stay user-owned and are never used as SDK/runtime install folders.
import "server-only";
import path from "node:path";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { defaultWorkspaceRoot, workspaceMetaRoot, workspaceRoot } from "./paths";
import { setResolvedRoot } from "./resolved-roots";
import { listBackgroundCommands, killBackgroundCommand } from "./background";
import { getProject } from "@/lib/db/repo";
import { get, run } from "@/lib/db/client";

// Re-export the cycle-safe helpers so existing imports keep working.
export { resolvedRoot, resolvedWorkspaceExists } from "./resolved-roots";

export interface WorkspaceInfo {
  chatId: string;
  rootDir: string;
  status: "running";
}

function removeDirIfEmpty(dir: string): void {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  } catch {
    /* leave user files alone */
  }
}

function moveLegacyDir(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
    rmSync(from, { recursive: true, force: true });
  } catch {
    /* If anything looks user-owned or locked, leave it in place. */
  }
}

function cleanupLegacyArtifactDirs(rootDir: string, chatId: string): void {
  const metaDir = workspaceMetaRoot(chatId);
  const legacyDownload = path.join(rootDir, "download");
  const managedDownload = path.join(metaDir, "download");
  for (const name of ["agent-browser", "screenshots", "plans"]) {
    moveLegacyDir(path.join(legacyDownload, name), path.join(managedDownload, name));
    moveLegacyDir(path.join(rootDir, ".vaultgate", "download", name), path.join(managedDownload, name));
  }
  removeDirIfEmpty(legacyDownload);

  const legacyUpload = path.join(rootDir, "upload");
  try {
    const entries = existsSync(legacyUpload) ? readdirSync(legacyUpload, { withFileTypes: true }) : [];
    const looksManaged = entries.every((entry) => /^\d{14}$/.test(entry.name));
    if (looksManaged) moveLegacyDir(legacyUpload, path.join(metaDir, "upload"));
  } catch {
    /* leave user files alone */
  }
  moveLegacyDir(path.join(rootDir, ".vaultgate", "upload"), path.join(metaDir, "upload"));
  removeDirIfEmpty(legacyUpload);
}

/** Resolve the workspace root for a chat — always computed fresh, never cached.
 *  - If the chat belongs to a project → use that project's folder path.
 *  - If no project → use the default VaultGate workspace. */
export async function resolveWorkspaceRoot(chatId: string): Promise<string> {
  try {
    const row = await get<{ project_id: string | null }>(
      "SELECT project_id FROM chats WHERE id = ?",
      [chatId],
    );

    if (row?.project_id) {
      const project = await getProject(row.project_id);
      if (project?.path) {
        await run("UPDATE chats SET workspace_path = ? WHERE id = ?", [project.path, chatId]);
        setResolvedRoot(chatId, project.path);
        return project.path;
      }
    }

    const home = defaultWorkspaceRoot();
    await run("UPDATE chats SET workspace_path = ? WHERE id = ?", [home, chatId]);
    setResolvedRoot(chatId, home);
    return home;
  } catch {
    /* fall through */
  }
  const fallback = defaultWorkspaceRoot();
  setResolvedRoot(chatId, fallback);
  return fallback;
}

export async function ensureWorkspace(chatId: string): Promise<WorkspaceInfo> {
  const rootDir = await resolveWorkspaceRoot(chatId);
  mkdirSync(rootDir, { recursive: true });

  // Workspace separation: workspace cwd is user-owned; VaultGate state lives
  // under app data per chat, not inside the selected project/home folder.
  // Artifact folders (download/, upload/, plans/) are created on demand by the
  // tools that use them — we don't pre-scaffold empty folders here.
  const metaDir = workspaceMetaRoot(chatId);
  mkdirSync(metaDir, { recursive: true });
  cleanupLegacyArtifactDirs(rootDir, chatId);

  const { ensureWorkspaceRuntime } = await import("./runtime");
  await ensureWorkspaceRuntime(rootDir, chatId);
  return { chatId, rootDir, status: "running" };
}

export function workspaceExists(chatId: string): boolean {
  return existsSync(workspaceMetaRoot(chatId));
}

export async function workspaceStatus(chatId: string): Promise<{ status: "running" | "not_found"; rootDir: string }> {
  const rootDir = await resolveWorkspaceRoot(chatId);
  return { status: existsSync(rootDir) ? "running" : "not_found", rootDir };
}

/** Stop every process this workspace owns (background commands). */
export function stopWorkspaceProcesses(chatId: string): void {
  try {
    for (const bg of listBackgroundCommands(chatId)) {
      if (bg.running) killBackgroundCommand(chatId, bg.id);
    }
  } catch {
    /* best effort */
  }
}

/**
 * Release a workspace: stop its processes, then remove its directory.
 * Best-effort and non-throwing — chat deletion must never fail because a file
 * handle lingered. Retries with backoff to let Windows release locks.
 */
export async function releaseWorkspace(chatId: string): Promise<{ removed: boolean }> {
  const rootDir = workspaceRoot(chatId);
  if (!existsSync(rootDir)) return { removed: true };

  stopWorkspaceProcesses(chatId);

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      rmSync(rootDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
      return { removed: true };
    } catch {
      if (!existsSync(rootDir)) return { removed: true };
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return { removed: !existsSync(rootDir) };
}
