import "server-only";
import path from "node:path";
import type { ApprovalSettings, QuestionOption } from "@/types";
import { canonicalToolName } from "./tools/definitions";
import { resolvedRoot } from "@/lib/runtime/workspace";
import { resolveWorkspacePath, workspaceMetaRoot } from "@/lib/runtime/paths";

export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  mode: "auto-safe",
  askForUnknownMcp: true,
  askForExternalActions: true,
  hardBlockDangerous: true,
};

type RiskKind = "read" | "write" | "shell" | "destructive" | "external" | "unknown";

export interface PermissionDecision {
  action: "allow" | "ask" | "block";
  risk: RiskKind;
  reason: string;
  summary: string;
  requestId?: string;
}

interface StoredPermissionRequest {
  id: string;
  chatId: string;
  toolName: string;
  argsHash: string;
  summary: string;
  expiresAt: number;
}

const pendingRequests = new Map<string, StoredPermissionRequest>();
const approvedOnce = new Set<string>();
const deniedOnce = new Set<string>();
const REQUEST_TTL_MS = 10 * 60_000;

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "XSearch", "RecallSessions", "MultiModel", "Skill", "BashOutput", "ListProcesses", "Vision", "Transcribe"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "ApplyPatch", "TodoWrite", "Kanban", "ImageGenerate", "ImageEdit"]);
const DESTRUCTIVE_TOOLS = new Set(["Delete", "Move"]);
const EXTERNAL_TOOLS = new Set(["Open", "Desktop", "Schedule", "Task"]);

export function normalizeApprovalSettings(settings: Partial<ApprovalSettings> | undefined): ApprovalSettings {
  return {
    ...DEFAULT_APPROVAL_SETTINGS,
    ...(settings ?? {}),
  };
}

export function consumePermissionResponse(chatId: string, content: string): { visibleText: string } | null {
  const match = content.match(/Permission response:\s*(.+?)\s*\nRequest id:\s*permission:([A-Za-z0-9_-]+)/is);
  if (!match) return null;
  const answer = match[1].trim().toLowerCase();
  const requestId = match[2];
  const request = pendingRequests.get(requestId);
  if (!request || request.chatId !== chatId || request.expiresAt < Date.now()) {
    if (request) pendingRequests.delete(requestId);
    return { visibleText: "The permission request expired. Retry the action if it is still needed." };
  }

  const key = permissionKey(chatId, request.toolName, request.argsHash);
  pendingRequests.delete(requestId);
  if (answer.startsWith("approve")) {
    approvedOnce.add(key);
    return { visibleText: `Approved once: ${request.summary}. Retry the exact action if it is still required.` };
  }
  deniedOnce.add(key);
  return { visibleText: `Denied: ${request.summary}. Choose a safer path or ask for a different scoped approval.` };
}

export function evaluateToolPermission(chatId: string, name: string, args: Record<string, unknown>, settings: ApprovalSettings, opts: { canAsk: boolean }): PermissionDecision {
  const toolName = canonicalToolName(name);
  const summary = summarizeTool(toolName, args);
  const argsHash = stableStringify(args);
  const key = permissionKey(chatId, toolName, argsHash);
  if (approvedOnce.delete(key)) return { action: "allow", risk: "write", reason: "Approved once by the user.", summary };
  if (deniedOnce.delete(key)) return { action: "block", risk: "destructive", reason: "The user denied this exact action.", summary };

  const classification = classifyTool(chatId, toolName, args, settings);
  if (classification.hardBlock && settings.hardBlockDangerous) {
    return { action: "block", risk: "destructive", reason: classification.reason, summary };
  }
  if (settings.mode === "auto-approve") return { action: "allow", risk: classification.risk, reason: "Auto Approve is enabled.", summary };
  if (settings.mode === "read-only" && classification.risk !== "read") {
    return { action: "block", risk: classification.risk, reason: "Read Only permission mode blocks mutating, shell, external, and unknown actions.", summary };
  }
  if (classification.risk === "read") return { action: "allow", risk: "read", reason: "Read-only action.", summary };
  if (settings.mode === "ask" || classification.ask) {
    if (!opts.canAsk) return { action: "block", risk: classification.risk, reason: `Approval required: ${classification.reason}`, summary };
    const requestId = rememberPermissionRequest(chatId, toolName, argsHash, summary);
    return { action: "ask", risk: classification.risk, reason: classification.reason, summary, requestId };
  }
  return { action: "allow", risk: classification.risk, reason: classification.reason, summary };
}

export function permissionQuestion(decision: PermissionDecision): { id: string; question: string; header: string; options: QuestionOption[] } {
  return {
    id: `permission:${decision.requestId}`,
    header: "Permission Required",
    question: `Approve this ${decision.risk} action?\n${decision.summary}\nReason: ${decision.reason}`,
    options: [
      { label: "Approve once", description: "Allow this exact action one time, then continue." },
      { label: "Deny", description: "Do not run it; the agent must choose a safer path." },
    ],
  };
}

function rememberPermissionRequest(chatId: string, toolName: string, argsHash: string, summary: string): string {
  pruneExpiredRequests();
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  pendingRequests.set(id, { id, chatId, toolName, argsHash, summary, expiresAt: Date.now() + REQUEST_TTL_MS });
  return id;
}

function pruneExpiredRequests(): void {
  const now = Date.now();
  for (const [id, request] of pendingRequests) {
    if (request.expiresAt < now) pendingRequests.delete(id);
  }
}

function permissionKey(chatId: string, toolName: string, argsHash: string): string {
  return `${chatId}:${toolName}:${argsHash}`;
}

function classifyTool(chatId: string, toolName: string, args: Record<string, unknown>, settings: ApprovalSettings): { risk: RiskKind; ask: boolean; hardBlock?: boolean; reason: string } {
  if (toolName.startsWith("mcp__")) return classifyMcp(toolName, settings);
  if (READ_ONLY_TOOLS.has(toolName)) {
    if (toolName === "WebFetch" && String(args.method || "GET").toUpperCase() !== "GET") {
      return { risk: "external", ask: true, reason: "WebFetch with a non-GET method can change remote state." };
    }
    return { risk: "read", ask: false, reason: "Read-only action." };
  }
  if (toolName === "Bash") return classifyCommand(String(args.command || ""));
  if (DESTRUCTIVE_TOOLS.has(toolName)) {
    return { risk: "destructive", ask: true, reason: "File delete/move can remove or overwrite durable user data." };
  }
  if (WRITE_TOOLS.has(toolName)) {
    const outside = toolTargetsOutsideWorkspace(chatId, toolName, args);
    return { risk: "write", ask: outside, reason: outside ? "This writes outside the active workspace." : "Workspace write action." };
  }
  if (EXTERNAL_TOOLS.has(toolName)) {
    return classifyExternalTool(toolName, args, settings);
  }
  return { risk: "unknown", ask: true, reason: "Unknown tool risk." };
}

function classifyMcp(toolName: string, settings: ApprovalSettings): { risk: RiskKind; ask: boolean; reason: string } {
  const short = toolName.split("__").pop()?.toLowerCase() ?? toolName.toLowerCase();
  if (/^(get|read|list|search|find|fetch|query|inspect|describe|status|lookup)/.test(short)) {
    return { risk: "read", ask: false, reason: "MCP tool appears read-only by name." };
  }
  return { risk: "unknown", ask: settings.askForUnknownMcp, reason: "Unknown MCP tools can mutate external systems or data." };
}

function classifyExternalTool(toolName: string, args: Record<string, unknown>, settings: ApprovalSettings): { risk: RiskKind; ask: boolean; reason: string } {
  if (toolName === "Task") return { risk: "external", ask: false, reason: "Sub-agent delegation stays under the same approval policy." };
  if (toolName === "Schedule") return { risk: "external", ask: String(args.action || "list") === "create", reason: "Scheduled tasks can run after the current turn." };
  if (!settings.askForExternalActions) return { risk: "external", ask: false, reason: "External-action prompts are disabled in settings." };
  const action = String(args.action || "open").toLowerCase();
  const text = [args.target, args.label, args.text, args.key].map((value) => String(value || "")).join(" ").toLowerCase();
  const riskyIntent = /\b(send|submit|post|publish|tweet|comment|delete|remove|buy|purchase|pay|checkout|login|sign in|password|token|secret|confirm|approve)\b/.test(text);
  if (toolName === "Desktop") {
    const mutating = !["windows", "screenshot", "wait", "clipboard_get", "focus"].includes(action);
    return { risk: "external", ask: mutating || riskyIntent, reason: "Desktop control can affect visible apps and external accounts." };
  }
  if (toolName === "Open") {
    const mutating = ["click", "type", "press"].includes(action);
    return { risk: "external", ask: riskyIntent || (mutating && /\b(enter|ctrl\+enter|return)\b/.test(text)), reason: "Visible browser actions may affect web apps or accounts." };
  }
  return { risk: "external", ask: true, reason: "External side effect." };
}

function classifyCommand(command: string): { risk: RiskKind; ask: boolean; hardBlock?: boolean; reason: string } {
  const hard = hardBlockedCommand(command);
  if (hard) return { risk: "destructive", ask: true, hardBlock: true, reason: hard };
  const risky = riskyCommand(command);
  if (risky) return { risk: "destructive", ask: true, reason: risky };
  const shellMutation = /\b(npm|pnpm|yarn|bun|pip|uv|poetry|cargo|go|dotnet|docker|git|gh)\b/i.test(command);
  return { risk: shellMutation ? "shell" : "shell", ask: false, reason: "Shell command in the active workspace." };
}

export function hardBlockedCommand(command: string): string | null {
  const normalized = command.replace(/`[^`]*`/g, " ").replace(/\s+/g, " ").trim();
  const patterns: Array<{ re: RegExp; reason: string }> = [
    { re: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(?:\/|~|\$HOME|%USERPROFILE%|[A-Za-z]:\\)(?:\s|$)/i, reason: "Refusing recursive force delete of a filesystem root or home directory." },
    { re: /\bremove-item\b[\s\S]*\b-recurse\b[\s\S]*\b-force\b[\s\S]*(?:\$env:(?:userprofile|systemroot|systemdrive)|[A-Za-z]:\\(?:windows|program files)?\b)/i, reason: "Refusing forced recursive delete of a protected Windows path." },
    { re: /\b(mkfs|diskpart|format\s+[A-Za-z]:|fdisk|parted)\b/i, reason: "Refusing disk formatting or partition commands." },
    { re: /\bdd\b[\s\S]*\bof=\/dev\/(?:sd|hd|nvme|disk|rdisk)/i, reason: "Refusing raw block-device writes." },
    { re: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*}\s*;/, reason: "Refusing fork-bomb pattern." },
    { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "Refusing machine shutdown or reboot commands." },
  ];
  return patterns.find((item) => item.re.test(normalized))?.reason ?? null;
}

function riskyCommand(command: string): string | null {
  const patterns: Array<{ re: RegExp; reason: string }> = [
    { re: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+--force|push\s+-f)\b/i, reason: "Destructive git command." },
    { re: /\brm\s+-[a-z]*r[a-z]*f|\bremove-item\b[\s\S]*\b-recurse\b[\s\S]*\b-force\b/i, reason: "Recursive forced deletion." },
    { re: /\bdrop\s+(?:database|schema|table)\b/i, reason: "Database drop command." },
    { re: /\b(?:npm|pnpm|yarn)\s+publish\b|\b(?:vercel|netlify|firebase|railway)\b[\s\S]*\b(?:deploy|--prod|production)\b/i, reason: "Publishing or production deployment." },
    { re: /\bcurl\b[\s\S]*\|\s*(?:sh|bash|pwsh|powershell)|\b(?:invoke-webrequest|iwr)\b[\s\S]*\|\s*(?:iex|invoke-expression)/i, reason: "Downloaded script execution." },
    { re: /\bsudo\b|\bset-executionpolicy\b|\bchmod\s+-R\s+777\b/i, reason: "Privilege, execution-policy, or broad permission change." },
    { re: /\bdocker\s+system\s+prune\b|\bkubectl\s+delete\b|\bterraform\s+(?:destroy|apply)\b/i, reason: "Infrastructure or broad container state change." },
  ];
  return patterns.find((item) => item.re.test(command))?.reason ?? null;
}

function toolTargetsOutsideWorkspace(chatId: string, toolName: string, args: Record<string, unknown>): boolean {
  const candidates: string[] = [];
  if (typeof args.filepath === "string") candidates.push(args.filepath);
  if (typeof args.path === "string") candidates.push(args.path);
  if (typeof args.source === "string") candidates.push(args.source);
  if (typeof args.destination === "string") candidates.push(args.destination);
  if (toolName === "ApplyPatch" && typeof args.patch === "string") {
    const matches = args.patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm);
    for (const match of matches) candidates.push(match[1].trim());
  }
  if (candidates.length === 0) return false;
  try {
    const root = resolvedRoot(chatId);
    const meta = workspaceMetaRoot(chatId);
    return candidates.some((candidate) => {
      const full = resolveWorkspacePath(candidate, root, meta);
      const rel = path.relative(root, full);
      return rel.startsWith("..") || path.isAbsolute(rel);
    });
  } catch {
    return true;
  }
}

function summarizeTool(toolName: string, args: Record<string, unknown>): string {
  const detail = String(args.command || args.filepath || args.path || args.source || args.destination || args.action || args.query || args.url || args.prompt || "").replace(/\s+/g, " ").trim();
  return detail ? `${toolName}: ${detail.slice(0, 220)}` : toolName;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}
