// Per-workspace terminal command history (JSONL). Helps the agent
// avoid repeating installs / failed commands across iterations.
import "server-only";
import path from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { workspaceMetaPath } from "./paths";

const HISTORY_FILE = "history.jsonl";

export interface HistoryEntry {
  command: string;
  exitCode: number;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
  at: string;
}

function tail(value: string, max = 4000): string {
  return value.length <= max ? value : value.slice(value.length - max);
}

export function appendHistory(
  chatId: string,
  e: Pick<HistoryEntry, "command" | "exitCode" | "timedOut"> & { stdout: string; stderr: string },
): void {
  try {
    const entry: HistoryEntry = {
      command: e.command,
      exitCode: e.exitCode,
      timedOut: e.timedOut,
      stdoutTail: tail(e.stdout),
      stderrTail: tail(e.stderr),
      at: new Date().toISOString(),
    };
    const file = workspaceMetaPath(chatId, HISTORY_FILE);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // History is best-effort; never fail a command because logging failed.
  }
}

export function readHistory(chatId: string, limit = 20): string {
  const file = workspaceMetaPath(chatId, HISTORY_FILE);
  if (!existsSync(file)) return "No terminal commands have been run in this workspace yet.";
  try {
    const lines = readFileSync(file, "utf-8").trim().split(/\r?\n/).filter(Boolean).slice(-Math.min(limit, 50));
    if (!lines.length) return "No terminal commands have been run in this workspace yet.";
    return lines
      .map((line, i) => {
        try {
          const e = JSON.parse(line) as HistoryEntry;
          const err = e.stderrTail?.trim() ? ` stderr: ${e.stderrTail.replace(/\s+/g, " ").slice(0, 200)}` : "";
          return `${i + 1}. exit ${e.exitCode}: ${e.command.replace(/\s+/g, " ").trim()}${err}`;
        } catch {
          return `${i + 1}. ${line}`;
        }
      })
      .join("\n");
  } catch {
    return "Terminal history exists but could not be read.";
  }
}
