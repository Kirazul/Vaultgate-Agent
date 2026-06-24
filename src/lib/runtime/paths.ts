// ============================================================
// Workspace paths & safety (server-only).
// Per-chat workspaces live under the app data dir. Relative paths
// stay contained in the workspace; absolute paths (and ~) reach the
// user's real machine — this is a local-first personal agent — with
// only catastrophic OS roots blocked.
// ============================================================
import "server-only";
import path from "node:path";
import os from "node:os";
import { getDataDir } from "@/lib/config/env";

export function workspacesRoot(): string {
  return path.join(/* turbopackIgnore: true */ getDataDir(), "workspaces");
}

export function sanitizeChatId(chatId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(chatId)) {
    throw new Error("Invalid chatId");
  }
  return chatId;
}

export function workspaceRoot(chatId: string): string {
  return path.join(workspacesRoot(), sanitizeChatId(chatId));
}

/** Default workspace when the user has not selected a project folder.
 * Uses a dedicated workspace directory so the home folder isn't cluttered. */
export function defaultWorkspaceRoot(): string {
  const workspace = path.join(/* turbopackIgnore: true */ getDataDir(), "workspace");
  return path.resolve(/* turbopackIgnore: true */ workspace);
}

/** Per-chat VaultGate-owned state, separate from the user's workspace cwd. */
export function workspaceStateRoot(chatId: string): string {
  return workspaceRoot(chatId);
}

/** Agent home for this chat: runtime, SDK, logs, uploads, artifacts. */
export function workspaceMetaRoot(chatId: string): string {
  return path.join(workspaceStateRoot(chatId), ".vaultgate");
}

export function workspaceMetaPath(chatId: string, ...parts: string[]): string {
  return path.join(workspaceMetaRoot(chatId), ...parts);
}

/** Resolve a path and assert it stays inside `root` (anti-traversal). */
export function assertInside(root: string, target: string): string {
  const r = path.resolve(/* turbopackIgnore: true */ root);
  const t = path.resolve(/* turbopackIgnore: true */ target);
  const rel = path.relative(r, t);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return t;
  throw new Error("Path traversal detected");
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** OS-critical roots the agent must never touch, even with absolute paths. */
function isProtectedSystemPath(target: string): boolean {
  const t = path.resolve(/* turbopackIgnore: true */ target);
  if (t === path.parse(t).root) return true; // a bare root: "C:\" or "/"
  if (process.platform === "win32") {
    const lower = t.toLowerCase();
    const roots = [process.env.WINDIR || "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"].map((r) => path.resolve(/* turbopackIgnore: true */ r).toLowerCase());
    return roots.some((r) => lower === r || lower.startsWith(r + path.sep));
  }
  const roots = ["/etc", "/usr", "/bin", "/sbin", "/boot", "/sys", "/proc", "/dev", "/lib", "/lib64", "/System", "/Library"];
  return roots.some((r) => t === r || t.startsWith(r + "/"));
}

/**
 * Resolve a path for a file tool.
 *  • Relative / workspace-aliased paths stay contained in the workspace.
 *  • Absolute paths and `~` reach the user's real filesystem (Desktop,
 *    Documents, projects, …) — allowed except protected OS roots.
 */
export function resolveWorkspacePath(filepath: string, root: string, metaRoot?: string): string {
  const managed = applyManagedAlias(filepath, metaRoot);
  if (managed) return managed;
  const aliased = expandHome(applyWorkspaceAlias(filepath, root));

  if (path.isAbsolute(aliased)) {
    const target = path.resolve(/* turbopackIgnore: true */ aliased);
    const rel = path.relative(path.resolve(/* turbopackIgnore: true */ root), target);
    const insideWorkspace = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (insideWorkspace) return target;
    if (isProtectedSystemPath(target)) {
      throw new Error(`Refusing to access a protected system path: ${target}`);
    }
    return target;
  }

  return assertInside(root, path.resolve(/* turbopackIgnore: true */ root, aliased));
}

function applyWorkspaceAlias(filepath: string, root: string): string {
  const normalized = String(filepath || ".").replace(/\\/g, "/");
  const rootUnix = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const aliases = ["/workspace/", "workspace://", "workspace:/", "workspace:"];
  if (["/workspace", "workspace:", "workspace:/", "workspace://"].includes(normalized)) return ".";
  for (const a of aliases) {
    if (normalized.startsWith(a)) return normalized.slice(a.length).replace(/^\/+/, "") || ".";
  }
  if (normalized.startsWith(`${rootUnix}/`)) return normalized;
  return filepath;
}

function applyManagedAlias(filepath: string, metaRoot?: string): string | null {
  if (!metaRoot) return null;
  const normalized = String(filepath || ".").replace(/\\/g, "/").replace(/^\/+/, "");
  const managedPrefixes = [".vaultgate", "vaultgate:", "vaultgate:/", "vaultgate://"];
  const raw = managedPrefixes.find((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  if (!raw) return null;
  const rel = normalized.slice(raw.length).replace(/^\/+/, "");
  return assertInside(metaRoot, path.resolve(/* turbopackIgnore: true */ metaRoot, rel || "."));
}
