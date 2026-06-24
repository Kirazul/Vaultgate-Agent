// Workspace dev-server lifecycle (server-only).
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { workspaceMetaPath } from "./paths";

const DEV_FILE = "devserver.json";

export interface DevServerInfo {
  chatId: string;
  rootDir?: string;
  command?: string;
  logFile?: string;
  port: number;
  pid?: number;
  status: "starting" | "running" | "stopped";
  startedAt: string;
}

function devFile(chatId: string): string {
  return workspaceMetaPath(chatId, DEV_FILE);
}

export function readDevServer(chatId: string): DevServerInfo | null {
  const file = devFile(chatId);
  if (!existsSync(file)) return null;
  try {
    const info = JSON.parse(readFileSync(file, "utf-8")) as DevServerInfo;
    const alive = isAlive(info.pid);
    return { ...info, pid: alive ? info.pid : undefined, status: alive ? info.status : "stopped" };
  } catch {
    return null;
  }
}

export function writeDevServer(info: DevServerInfo): void {
  const file = devFile(info.chatId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(info, null, 2), "utf-8");
}

export function rememberAppRoot(chatId: string, rootDir: string, command?: string): void {
  const existing = readDevServer(chatId);
  writeDevServer({
    chatId,
    rootDir,
    command: command || existing?.command,
    logFile: existing?.logFile,
    port: existing?.port ?? 0,
    pid: existing?.pid,
    status: existing?.pid ? (existing.status === "running" || existing.status === "starting" ? existing.status : "stopped") : "stopped",
    startedAt: existing?.startedAt ?? new Date().toISOString(),
  });
}

export function isAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Pick a free loopback port. Never return a port that is already bound. */
export async function findPort(chatId: string): Promise<number> {
  void chatId;
  const base = 4100 + Math.floor(Math.random() * 2400);
  for (let offset = 0; offset < 250; offset++) {
    const port = base + offset;
    if (port !== 3000 && (await portFree(port))) return port;
  }
  for (let port = 4100; port < 10000; port++) {
    if (port !== 3000 && (await portFree(port))) return port;
  }
  throw new Error("No free local port was available for the dev server.");
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

export function portReachable(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function waitForPort(port: number, timeoutMs = 60000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await portReachable(port, 800)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}
