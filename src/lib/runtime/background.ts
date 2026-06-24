// ============================================================
// Background command manager (server-only).
// Runs a workspace command detached, captures its output to a
// log file, and lets the agent poll/stop it by id. Survives
// across API requests because state lives on disk in the
// VaultGate-owned app data, not just in process memory.
// ============================================================
import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolvedRoot } from "./resolved-roots";
import { workspaceMetaPath, workspaceMetaRoot } from "./paths";
import { getRuntimeLaunchContext } from "./execution-runtime";
import { killProcessTree, windowsShell, wrapWindowsCommand } from "./process";

// Background commands run through the SAME shell wrapping as foreground commands
// (see execution-runtime.ts). On Windows that means the wrapped PowerShell with
// the .vaultgate PATH shims, POSIX compatibility shims (mkdir -p, touch, head,
// python), and the agent-browser wrapper. Routing background commands through a
// bare cmd.exe instead would silently drop all of that, so a command that works
// in the foreground would fail when auto-detected as a long-running server. Keep
// the two paths identical so behaviour never diverges by execution mode.

interface BackgroundRecord {
  id: string;
  command: string;
  pid?: number;
  startedAt: string;
  logFile: string;
}

function bgDir(chatId: string): string {
  return workspaceMetaPath(chatId, "bg");
}

function registryPath(chatId: string): string {
  return path.join(bgDir(chatId), "registry.json");
}

function readRegistry(chatId: string): Record<string, BackgroundRecord> {
  try {
    return JSON.parse(readFileSync(registryPath(chatId), "utf-8")) as Record<string, BackgroundRecord>;
  } catch {
    return {};
  }
}

function writeRegistry(chatId: string, registry: Record<string, BackgroundRecord>): void {
  mkdirSync(bgDir(chatId), { recursive: true });
  writeFileSync(registryPath(chatId), JSON.stringify(registry, null, 2), "utf-8");
}

function pidAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function backgroundLaunch(command: string, root: string, metaRoot: string): { shell: string; args: string[] } {
  if (process.platform !== "win32") return { shell: "bash", args: ["-lc", command] };
  return { shell: windowsShell(), args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapWindowsCommand(root, command, metaRoot)] };
}

/** Start a command in the background; returns its handle id immediately. */
export function startBackgroundCommand(chatId: string, command: string): { id: string } {
  const root = resolvedRoot(chatId);
  const dir = bgDir(chatId);
  mkdirSync(dir, { recursive: true });

  const id = `bg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const logFile = path.join(dir, `${id}.log`);
  writeFileSync(logFile, "", "utf-8");

  const { shell, args } = backgroundLaunch(command, root, workspaceMetaRoot(chatId));
  const launch = getRuntimeLaunchContext(chatId);

  // Redirect both streams to the log file via a file descriptor so we avoid
  // any shell-quoting pitfalls around the log path.
  const out = openSync(logFile, "a");
  const detached = process.platform !== "win32";
  const child = spawn(shell, args, { cwd: launch.cwd, env: launch.env, detached, stdio: ["ignore", out, out] });
  try {
    closeSync(out);
  } catch {
    /* child has its own handle */
  }
  child.on("error", (error) => {
    try {
      appendFileSync(logFile, `\n[VaultGate] Failed to start background command: ${error.message}\n`, "utf-8");
    } catch {
      /* ignore logging failures */
    }
  });
  child.on("close", (code, signal) => {
    try {
      const status = code === null ? `signal ${signal || "unknown"}` : `code ${code}`;
      appendFileSync(logFile, `\n[VaultGate] Background command exited with ${status}.\n`, "utf-8");
    } catch {
      /* ignore logging failures */
    }
  });
  if (detached) child.unref();

  const registry = readRegistry(chatId);
  registry[id] = { id, command, pid: child.pid, startedAt: new Date().toISOString(), logFile };
  writeRegistry(chatId, registry);

  return { id };
}

export interface BackgroundStatus {
  id: string;
  command: string;
  running: boolean;
  output: string;
  startedAt?: string;
}

/** Read a background command's captured output and whether it is still running. */
export function readBackgroundOutput(chatId: string, id: string, tailBytes = 8000): BackgroundStatus | null {
  const record = readRegistry(chatId)[id];
  if (!record) return null;
  let output = "";
  try {
    const raw = readFileSync(record.logFile, "utf-8");
    output = raw.length > tailBytes ? `... (truncated)\n${raw.slice(-tailBytes)}` : raw;
  } catch {
    output = "(no output captured yet)";
  }
  return { id, command: record.command, running: pidAlive(record.pid), output, startedAt: record.startedAt };
}

/** Stop a background command. Returns true if a live process was signalled. */
export function killBackgroundCommand(chatId: string, id: string): boolean {
  const record = readRegistry(chatId)[id];
  if (!record?.pid) return false;
  if (!pidAlive(record.pid)) return false;
  try {
    killProcessTree(record.pid);
    return true;
  } catch {
    return false;
  }
}

/** List background commands known for this chat. */
export function listBackgroundCommands(chatId: string): BackgroundStatus[] {
  if (!existsSync(registryPath(chatId))) return [];
  const registry = readRegistry(chatId);
  return Object.values(registry).map((r) => ({ id: r.id, command: r.command, running: pidAlive(r.pid), output: "", startedAt: r.startedAt }));
}
