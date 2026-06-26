// Client-safe helpers for rendering tool-call cards. No server imports.
import type { ToolCall, ToolResult } from "@/types";
import { parseJsonLoose } from "@/lib/utils";

export type ToolKind = "terminal" | "file" | "research" | "todo" | "skill" | "agent" | "generic";
export type ToolLifecycle = "queued" | "running" | "completed" | "error";

export interface ToolDisplaySpec {
  kind: ToolKind;
  userFacingName: string;
  queued: string;
  running: string;
  completed: string;
  error: string;
  group?: "research";
}

const TOOL_SPECS: Record<string, ToolDisplaySpec> = {
  bash: { kind: "terminal", userFacingName: "Terminal", queued: "Preparing command", running: "Running", completed: "Ran", error: "Command failed" },
  bashoutput: { kind: "terminal", userFacingName: "Background", queued: "Checking background task", running: "Checking background task", completed: "Checked background task", error: "Check failed" },
  read: { kind: "research", userFacingName: "Read", queued: "Preparing to read", running: "Reading", completed: "Read", error: "Read failed", group: "research" },
  ls: { kind: "research", userFacingName: "List", queued: "Preparing to list", running: "Listing", completed: "Listed", error: "List failed", group: "research" },
  glob: { kind: "research", userFacingName: "Find", queued: "Preparing to find", running: "Finding", completed: "Found", error: "Find failed", group: "research" },
  grep: { kind: "research", userFacingName: "Search", queued: "Preparing to search", running: "Searching", completed: "Searched", error: "Search failed", group: "research" },
  webfetch: { kind: "research", userFacingName: "Web", queued: "Preparing to fetch", running: "Fetching", completed: "Fetched", error: "Fetch failed", group: "research" },
  websearch: { kind: "research", userFacingName: "Search", queued: "Searching the web", running: "Searching the web", completed: "Searched the web", error: "Search failed", group: "research" },
  listprocesses: { kind: "research", userFacingName: "Processes", queued: "Checking processes", running: "Checking running processes", completed: "Checked running processes", error: "Check failed", group: "research" },
  open: { kind: "generic", userFacingName: "Open", queued: "Preparing to open", running: "Opening", completed: "Opened", error: "Open failed" },
  desktop: { kind: "generic", userFacingName: "Desktop", queued: "Preparing desktop action", running: "Controlling desktop", completed: "Controlled desktop", error: "Desktop action failed" },
  write: { kind: "file", userFacingName: "Write", queued: "Preparing to create", running: "Creating", completed: "Created", error: "Create failed" },
  edit: { kind: "file", userFacingName: "Edit", queued: "Preparing to edit", running: "Editing", completed: "Edited", error: "Edit failed" },
  multiedit: { kind: "file", userFacingName: "MultiEdit", queued: "Preparing to edit", running: "Editing", completed: "Edited", error: "Edit failed" },
  applypatch: { kind: "file", userFacingName: "Patch", queued: "Preparing to patch", running: "Applying patch", completed: "Patched", error: "Patch failed" },
  delete: { kind: "file", userFacingName: "Delete", queued: "Preparing to delete", running: "Deleting", completed: "Deleted", error: "Delete failed" },
  move: { kind: "file", userFacingName: "Move", queued: "Preparing to move", running: "Moving", completed: "Moved", error: "Move failed" },
  todowrite: { kind: "todo", userFacingName: "Todo", queued: "Updating tasks", running: "Updating tasks", completed: "Updated tasks", error: "Task update failed" },
  skill: { kind: "skill", userFacingName: "Skill", queued: "Loading skill", running: "Loading skill", completed: "Loaded skill", error: "Skill failed" },
  task: { kind: "agent", userFacingName: "Sub-agent", queued: "Invoking sub-agent", running: "Running sub-agent", completed: "Sub-agent finished", error: "Sub-agent failed" },
  kanban: { kind: "todo", userFacingName: "Board", queued: "Updating board", running: "Updating board", completed: "Updated board", error: "Board update failed" },
  recallsessions: { kind: "research", userFacingName: "Recall", queued: "Searching past chats", running: "Searching past chats", completed: "Searched past chats", error: "Recall failed", group: "research" },
  multimodel: { kind: "agent", userFacingName: "Multi-model", queued: "Consulting models", running: "Consulting models", completed: "Consulted models", error: "Multi-model failed" },
  schedule: { kind: "generic", userFacingName: "Schedule", queued: "Scheduling", running: "Scheduling", completed: "Scheduled", error: "Schedule failed" },
  xsearch: { kind: "research", userFacingName: "X Search", queued: "Searching X", running: "Searching X", completed: "Searched X", error: "X search failed", group: "research" },
  askuserquestion: { kind: "generic", userFacingName: "Question", queued: "Preparing question", running: "Asking", completed: "Asked you a question", error: "Question failed" },
  plan: { kind: "todo", userFacingName: "Plan", queued: "Drafting plan", running: "Drafting implementation plan", completed: "Proposed an implementation plan", error: "Plan failed" },
};

export function normalizeToolName(name: string): string {
  return String(name || "")
    .trim()
    .replace(/^functions\./i, "")
    .replace(/[^a-z0-9_-]/gi, "")
    .toLowerCase();
}

export function toolDisplaySpec(name: string): ToolDisplaySpec {
  const normalized = normalizeToolName(name);
  return TOOL_SPECS[normalized] || { kind: "generic", userFacingName: name || "Tool", queued: "Queued", running: "Running", completed: "Completed", error: "Failed" };
}

export function isResearchTool(name: string): boolean {
  return toolDisplaySpec(name).group === "research";
}

export function toolLifecycle(result: Pick<ToolResult, "status"> | undefined): ToolLifecycle {
  if (!result) return "queued";
  if (result.status === "running") return "running";
  if (result.status === "error") return "error";
  return "completed";
}

export function lifecycleLabel(spec: ToolDisplaySpec, lifecycle: ToolLifecycle): string {
  return spec[lifecycle];
}

function openAction(args: string): string {
  const a = parseJsonLoose(args) || {};
  return String(a.action || "open").trim().toLowerCase() || "open";
}

export function toolActionLabel(name: string, args: string, lifecycle: ToolLifecycle): string {
  const n = normalizeToolName(name);
  if (n !== "open") return lifecycleLabel(toolDisplaySpec(name), lifecycle);

  const labels: Record<string, Record<ToolLifecycle, string>> = {
    open: { queued: "Queued open", running: "Opening", completed: "Opened", error: "Open failed" },
    navigate: { queued: "Queued navigation", running: "Navigating", completed: "Navigated", error: "Navigation failed" },
    go: { queued: "Queued navigation", running: "Navigating", completed: "Navigated", error: "Navigation failed" },
    new_tab: { queued: "Queued new tab", running: "Opening tab", completed: "Opened tab", error: "Tab open failed" },
    list_tabs: { queued: "Queued tab list", running: "Listing tabs", completed: "Listed tabs", error: "Tab list failed" },
    tabs: { queued: "Queued tab list", running: "Listing tabs", completed: "Listed tabs", error: "Tab list failed" },
    close_tab: { queued: "Queued tab close", running: "Closing tab", completed: "Closed tab", error: "Tab close failed" },
    activate_tab: { queued: "Queued tab switch", running: "Switching tab", completed: "Switched tab", error: "Tab switch failed" },
    focus_tab: { queued: "Queued tab switch", running: "Switching tab", completed: "Switched tab", error: "Tab switch failed" },
    close_browser: { queued: "Queued browser close", running: "Closing browser", completed: "Closed browser", error: "Browser close failed" },
    inspect: { queued: "Queued inspection", running: "Inspecting page", completed: "Inspected page", error: "Inspection failed" },
    observe: { queued: "Queued inspection", running: "Inspecting page", completed: "Inspected page", error: "Inspection failed" },
    click: { queued: "Queued click", running: "Clicking", completed: "Clicked", error: "Click failed" },
    type: { queued: "Queued typing", running: "Typing", completed: "Typed", error: "Typing failed" },
    press: { queued: "Queued key press", running: "Pressing key", completed: "Pressed key", error: "Key press failed" },
    key: { queued: "Queued key press", running: "Pressing key", completed: "Pressed key", error: "Key press failed" },
    wait: { queued: "Queued wait", running: "Waiting", completed: "Waited", error: "Wait failed" },
    screenshot: { queued: "Queued screenshot", running: "Capturing screenshot", completed: "Captured screenshot", error: "Screenshot failed" },
  };

  return (labels[openAction(args)] || labels.open)[lifecycle];
}

// Plain-language, beginner-friendly explanation of what each tool does.
// Shown as a tooltip so a non-technical user understands the activity.
const TOOL_HINTS: Record<string, string> = {
  bash: "Running a command in the workspace terminal",
  bashoutput: "Checking on a background task it started",
  read: "Reading a file in the workspace",
  ls: "Listing the contents of a folder",
  glob: "Looking for files by name or pattern",
  grep: "Searching for text inside files",
  webfetch: "Opening a web page to read it",
  websearch: "Searching the web for up-to-date information",
  listprocesses: "Checking what is running in the workspace (servers, background tasks)",
  open: "Opening a URL or app in your real desktop browser",
  desktop: "Controlling a visible native desktop app on your real machine",
  write: "Creating a new file in the workspace",
  edit: "Making a change to a file",
  multiedit: "Making several changes to a file",
  applypatch: "Applying a patch across one or more files at once",
  delete: "Deleting a file or directory",
  move: "Moving or renaming a file or directory",
  todowrite: "Updating its task checklist",
  skill: "Loading a specialized skill with extra instructions",
  task: "Delegating to a sub-agent that works on this independently and reports back",
  kanban: "Updating its durable task board for this project",
  recallsessions: "Searching your past chats for relevant earlier work",
  multimodel: "Asking several models the same question and combining their answers",
  schedule: "Setting up a task to run later or on a repeating schedule",
  xsearch: "Searching X (Twitter) for recent posts and discussion",
  askuserquestion: "Asking you a clarifying question before continuing",
  plan: "Drafting an implementation plan for you to review and approve",
};

export function toolHint(name: string): string {
  return TOOL_HINTS[normalizeToolName(name)] || "Using a tool to work on your request";
}

export function resultPreview(content: string, max = 320): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function firstString(...values: unknown[]): string {
  for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function decodePartialJsonString(raw: string): string {
  let safe = raw;
  if (safe.endsWith("\\")) safe = safe.slice(0, -1);
  try {
    return JSON.parse(`"${safe.replace(/\r?\n/g, "\\n")}"`) as string;
  } catch {
    return safe
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function extractPartialJsonStrings(source: string, key: string): string[] {
  const values: string[] = [];
  const needle = `"${key}"`;
  let searchAt = 0;
  while (searchAt < source.length) {
    const keyAt = source.indexOf(needle, searchAt);
    if (keyAt === -1) break;
    const colonAt = source.indexOf(":", keyAt + needle.length);
    if (colonAt === -1) break;
    const quoteAt = source.indexOf('"', colonAt + 1);
    if (quoteAt === -1) break;

    let escaped = false;
    let end = quoteAt + 1;
    while (end < source.length) {
      const char = source[end];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') break;
      end++;
    }
    values.push(decodePartialJsonString(source.slice(quoteAt + 1, end)));
    searchAt = Math.max(end + 1, quoteAt + 1);
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

export function extractStringField(args: string, keys: string[]): string {
  const parsed = parseJsonLoose(args) || {};
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const key of keys) {
    const value = extractPartialJsonStrings(args, key)[0];
    if (value) return value;
  }
  return "";
}

export function extractFilePath(args: string): string {
  return extractStringField(args, [
    "filepath",
    "file_path",
    "filePath",
    "path",
    "relativePath",
    "relative_path",
    "source",
    "destination",
    "from",
    "to",
    "oldPath",
    "old_path",
    "newPath",
    "new_path",
    "target",
    "filename",
  ]);
}

export function summarizeTool(name: string, args: string): string {
  const n = normalizeToolName(name);
  const a = parseJsonLoose(args) || {};
  if (n === "bash") return firstString(a.description, a.command) || "run a command";
  if (n === "webfetch") return firstString(a.url) || "fetch a page";
  if (n === "grep") return `search "${firstString(a.pattern) || "…"}"`;
  if (n === "glob") return firstString(a.pattern) || "find files";
  if (n === "skill") return firstString(a.command) || "load skill";
  if (n === "applypatch") {
    const patch = extractStringField(args, ["patch", "input"]);
    const files = (patch.match(/^\*\*\* (?:Update|Add|Delete) File:/gm) || []).length;
    return files ? `${files} file${files === 1 ? "" : "s"}` : "apply patch";
  }
  if (n === "kanban") {
    const action = firstString(a.action) || "list";
    return firstString(a.title, a.id) ? `${action}: ${firstString(a.title, a.id)}` : action;
  }
  if (n === "recallsessions") {
    const action = (firstString(a.action) || (firstString(a.chat_id) ? "read" : firstString(a.query) ? "search" : "recent")).toLowerCase();
    if (action === "search") return `search "${firstString(a.query) || "missing query"}"`;
    if (action === "read") return `read chat ${firstString(a.chat_id) || "selected"}`;
    if (action === "list") return "list all chats";
    if (action === "recent") return "recent chats";
    return action;
  }
  if (n === "xsearch") return `X: "${firstString(a.query) || "…"}"`;
  if (n === "multimodel") {
    const models = Array.isArray(a.models) ? (a.models as unknown[]).length : 0;
    return models ? `${models} models` : firstString(a.prompt).slice(0, 60) || "multi-model";
  }
  if (n === "schedule") {
    const action = firstString(a.action) || "list";
    return firstString(a.title, a.prompt).slice(0, 60) ? `${action}: ${firstString(a.title, a.prompt).slice(0, 60)}` : action;
  }
  if (n === "task") {
    const type = firstString(a.subagent_type);
    const description = firstString(a.description) || "run a sub-agent";
    return type ? `${type}: ${description}` : description;
  }
  if (n === "open") {
    const action = openAction(args);
    if (action === "open" || action === "new_tab" || action === "navigate" || action === "go") return firstString(a.app, a.target, a.url) || "browser";
    if (action === "click") return firstString(a.label, a.selector, a.target) || (typeof a.x === "number" && typeof a.y === "number" ? `${a.x},${a.y}` : "element");
    if (action === "type") return firstString(a.label, a.selector, a.target) || "field";
    if (action === "press" || action === "key") return firstString(a.key, a.text) || "key";
    if (action === "wait") {
      const amount = typeof a.amount === "number" ? a.amount : undefined;
      return firstString(a.label, a.text, a.selector) || (amount ? `${amount >= 1000 ? `${amount / 1000}s` : `${amount}ms`}` : "");
    }
    if (action === "close_tab" || action === "activate_tab" || action === "focus_tab") return firstString(a.target_id, a.target, a.url) || "tab";
    if (action === "screenshot" || action === "inspect" || action === "observe" || action === "list_tabs" || action === "tabs" || action === "close_browser") return "";
    return firstString(a.label, a.selector, a.target, a.url, a.app) || "";
  }
  if (n === "delete") return firstString(a.path) || "delete a file";
  if (n === "move") {
    const s = firstString(a.source);
    const d = firstString(a.destination);
    return s && d ? `${baseName(s)} → ${baseName(d)}` : "move a file";
  }
  if (n === "askuserquestion") return firstString(a.header, a.question) || "ask a question";
  if (n === "plan") return firstString(a.title) || "implementation plan";
  const fp = extractFilePath(args);
  if (fp) return baseName(fp);
  const content = firstString(a.content);
  if (content) return `${content.slice(0, 60).replace(/\s+/g, " ")}…`;
  return firstString(a.query) || name;
}

// ── Line-level diff (LCS) ────────────────────────────────────
// A real diff: unchanged lines are "context", only genuinely changed lines are
// add/remove. This drives both the stat badges (+N -M) and the inline DiffView,
// so a one-line change inside a ten-line block reads as "+1 -1" instead of the
// old naive "+10 -10" (every old line removed, every new line added).
export type DiffRowType = "context" | "add" | "remove";
export interface DiffRow {
  type: DiffRowType;
  text: string;
}

export function lineDiff(oldStr: string, newStr: string): DiffRow[] {
  const a = oldStr === "" ? [] : oldStr.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const b = newStr === "" ? [] : newStr.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (a.length === 0) return b.map((text) => ({ type: "add" as const, text }));
  if (b.length === 0) return a.map((text) => ({ type: "remove" as const, text }));
  // Cap the O(n*m) table so a huge block can't lock up the UI; fall back to the
  // simple "all removed then all added" view in that rare case.
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ type: "remove" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: "context", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "remove", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) rows.push({ type: "remove", text: a[i++] });
  while (j < n) rows.push({ type: "add", text: b[j++] });
  return rows;
}

export function diffRowStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.type === "add") added++;
    else if (r.type === "remove") removed++;
  }
  return { added, removed };
}

export function diffStats(name: string, args: string): { added: number; removed: number } | null {
  const n = normalizeToolName(name);
  const a = parseJsonLoose(args) || {};
  if (n === "write") {
    const c = String(a.content || extractStringField(args, ["content"]));
    return c ? { added: c.replace(/\r\n/g, "\n").split("\n").length, removed: 0 } : null;
  }
  if (n === "edit") {
    return diffRowStats(lineDiff(String(a.old_str || extractStringField(args, ["old_str"])), String(a.new_str || extractStringField(args, ["new_str"]))));
  }
  if (n === "multiedit") {
    const edits = Array.isArray(a.edits) ? (a.edits as Array<Record<string, unknown>>) : [];
    let added = 0;
    let removed = 0;
    for (const e of edits) {
      const s = diffRowStats(lineDiff(String(e.old_str || extractStringField(args, ["old_str"])), String(e.new_str || extractStringField(args, ["new_str"]))));
      added += s.added;
      removed += s.removed;
    }
    return { added, removed };
  }
  if (n === "applypatch") {
    const patchDiffs = collectPatchDiffs(extractStringField(args, ["patch", "input"]));
    if (patchDiffs.length === 0) return null;
    return patchDiffs.reduce(
      (total, diff) => ({ added: total.added + diff.stats.added, removed: total.removed + diff.stats.removed }),
      { added: 0, removed: 0 },
    );
  }
  if (n === "delete" || n === "move") return { added: 0, removed: 0 };
  return null;
}

export interface Todo {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export function parseTodos(args: string): Todo[] {
  const a = parseJsonLoose(args);
  const todos = a?.todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((t): Todo[] => {
    if (!t || typeof t !== "object") return [];
    const d = t as Record<string, unknown>;
    const status =
      d.status === "completed" || d.status === "in_progress" || d.status === "pending" ? d.status : "pending";
    return [{ id: typeof d.id === "string" ? d.id : undefined, content: String(d.content || "Untitled"), status }];
  });
}

// ── File-type icon helper ───────────────────────────────────
const EXT_ICONS: Record<string, string> = {
  css: "{}",
  scss: "{}",
  less: "{}",
  ts: "TS",
  tsx: "TS",
  js: "JS",
  jsx: "JS",
  json: "{}",
  cs: "C#",
  py: "PY",
  rb: "RB",
  go: "Go",
  rs: "RS",
  java: "JV",
  kt: "K",
  swift: "SW",
  md: "MD",
  mdx: "MD",
  yaml: "YML",
  yml: "YML",
  toml: "TOML",
  html: "HTML",
  svg: "SVG",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
  gif: "IMG",
  sql: "SQL",
  sh: "$",
  bat: "$",
  ps1: "$",
  razor: "CS",
};

export function fileTypeIcon(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_ICONS[ext] ?? "TXT";
}

// ── Explored items counter ──────────────────────────────────
export function countExploredItems(calls: ToolCall[]): { files: number; folders: number } {
  let files = 0;
  let folders = 0;
  for (const call of calls) {
    const n = normalizeToolName(call.name);
    if (n === "ls") {
      folders++;
    } else {
      files++;
    }
  }
  return { files, folders };
}

// ── Aggregate diff stats across all edit tool calls in a message ──
export interface FileDiffEntry {
  filePath: string;
  hunks: { old: string; next: string }[];
  stats: { added: number; removed: number };
}

export function collectPatchDiffs(patch: string): FileDiffEntry[] {
  const entries: FileDiffEntry[] = [];
  let current: FileDiffEntry | null = null;
  let oldLines: string[] = [];
  let nextLines: string[] = [];

  const flushHunk = () => {
    if (!current) return;
    const old = oldLines.join("\n");
    const next = nextLines.join("\n");
    if (old || next) {
      const stats = diffRowStats(lineDiff(old, next));
      current.hunks.push({ old, next });
      current.stats.added += stats.added;
      current.stats.removed += stats.removed;
    }
    oldLines = [];
    nextLines = [];
  };

  const ensureEntry = (filePath: string) => {
    flushHunk();
    const path = filePath.trim() || "patch";
    current = entries.find((entry) => entry.filePath === path) ?? null;
    if (!current) {
      current = { filePath: path, hunks: [], stats: { added: 0, removed: 0 } };
      entries.push(current);
    }
  };

  for (const rawLine of patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const fileMatch = /^\*\*\*\s+(?:Update|Add|Delete) File:\s*(.+)$/.exec(rawLine);
    if (fileMatch) {
      ensureEntry(fileMatch[1]);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("@@")) {
      flushHunk();
      continue;
    }
    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      nextLines.push(rawLine.slice(1));
      continue;
    }
    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      oldLines.push(rawLine.slice(1));
      continue;
    }
    if (rawLine.startsWith(" ")) {
      const context = rawLine.slice(1);
      oldLines.push(context);
      nextLines.push(context);
    }
  }
  flushHunk();

  return entries;
}

export function collectFileDiffs(calls: ToolCall[]): FileDiffEntry[] {
  const entries: FileDiffEntry[] = [];
  for (const call of calls) {
    const n = normalizeToolName(call.name);
    if (!["write", "edit", "multiedit", "applypatch", "delete", "move"].includes(n)) continue;
    const a = parseJsonLoose(call.arguments) || {};
    if (n === "applypatch") {
      for (const patchDiff of collectPatchDiffs(extractStringField(call.arguments, ["patch", "input"]))) {
        const existing = entries.find((entry) => entry.filePath === patchDiff.filePath);
        if (existing) {
          existing.hunks.push(...patchDiff.hunks);
          existing.stats.added += patchDiff.stats.added;
          existing.stats.removed += patchDiff.stats.removed;
        } else {
          entries.push(patchDiff);
        }
      }
      continue;
    }
    const moveSource = firstString(a.source, a.from, a.oldPath, a.old_path) || extractStringField(call.arguments, ["source", "from", "oldPath", "old_path"]);
    const moveDestination = firstString(a.destination, a.dest, a.to, a.newPath, a.new_path) || extractStringField(call.arguments, ["destination", "dest", "to", "newPath", "new_path"]);
    const fp = n === "move" && moveSource && moveDestination ? `${moveSource} → ${moveDestination}` : extractFilePath(call.arguments) || "unknown file";
    const hunks: { old: string; next: string }[] = [];
    if (n === "write") hunks.push({ old: "", next: String(a.content ?? extractStringField(call.arguments, ["content"])) });
    else if (n === "edit") hunks.push({ old: String(a.old_str ?? extractStringField(call.arguments, ["old_str"])), next: String(a.new_str ?? extractStringField(call.arguments, ["new_str"])) });
    else if (n === "multiedit") {
      for (const e of Array.isArray(a.edits) ? (a.edits as Array<Record<string, unknown>>) : []) {
        hunks.push({ old: String(e?.old_str ?? ""), next: String(e?.new_str ?? "") });
      }
    }
    const stats = diffStats(call.name, call.arguments) ?? { added: 0, removed: 0 };
    // Merge into existing entry for same file
    const existing = entries.find((e) => e.filePath === fp);
    if (existing) {
      existing.hunks.push(...hunks);
      existing.stats.added += stats.added;
      existing.stats.removed += stats.removed;
    } else {
      entries.push({ filePath: fp, hunks, stats });
    }
  }
  return entries;
}
