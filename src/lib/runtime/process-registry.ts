// Unified managed-process view for workspace orchestration (server-only).
// All processes are background commands managed by background.ts.
import "server-only";
import { killBackgroundCommand, listBackgroundCommands, readBackgroundOutput } from "./background";

export type ManagedProcessKind = "background";

export interface ManagedProcessStatus {
  id: string;
  kind: ManagedProcessKind;
  command: string;
  running: boolean;
  pid?: number;
  port?: number;
  startedAt?: string;
  output?: string;
}

export function listManagedProcesses(chatId: string): ManagedProcessStatus[] {
  return listBackgroundCommands(chatId).map((bg) => ({
    id: bg.id,
    kind: "background" as const,
    command: bg.command,
    running: bg.running,
    output: bg.output,
    startedAt: bg.startedAt,
  }));
}

export function readManagedProcess(chatId: string, id: string): ManagedProcessStatus | null {
  const bg = readBackgroundOutput(chatId, id);
  if (!bg) return null;
  return { id: bg.id, kind: "background", command: bg.command, running: bg.running, output: bg.output };
}

export function killManagedProcess(chatId: string, id: string): boolean {
  return killBackgroundCommand(chatId, id);
}
