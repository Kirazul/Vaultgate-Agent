"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Circle,
  Code2,
  ExternalLink,
  Folder,
  Loader2,
  Server,
  Sparkles,
  Wand2,
  AlertTriangle,
} from "lucide-react";
import type { ContentBlock, Message, ToolCall, ToolResult } from "@/types";
import {
  baseName,
  collectFileDiffs,
  collectPatchDiffs,
  countExploredItems,
  diffStats,
  lineDiff,
  type DiffRow,
  extractFilePath,
  extractStringField,
  isResearchTool,
  lifecycleLabel,
  normalizeToolName,
  parseTodos,
  resultPreview,
  summarizeTool,
  toolActionLabel,
  toolDisplaySpec,
  toolLifecycle,
  type FileDiffEntry,
  type Todo,
  type ToolLifecycle,
} from "@/lib/ai/tool-display";
import { parseJsonLoose } from "@/lib/utils";
import { modeDef, isChatMode } from "@/lib/modes";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { useChatStore } from "@/lib/store/chat-store";
import { cn, stripAnsi } from "@/lib/utils";
import { useElapsed, formatElapsed } from "@/hooks/use-elapsed";
import { TerminalOutput } from "./TerminalOutput";
import { HiLine } from "./CodeHighlight";
import { FileSymbolIcon } from "@/components/icons/FileSymbolIcon";

/**
 * Live per-tool timer. Counts in real time while the tool is queued or
 * running (anchored to the client-side `call.startedAt`), then freezes
 * at the authoritative `result.durationMs` once the result lands.
 */
function ToolTimer({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const lifecycle = toolLifecycle(result);
  const active = lifecycle === "queued" || lifecycle === "running";
  const ms = useElapsed(active, call.startedAt, result?.durationMs);
  if (!active && !result?.durationMs) return null;
  return <span className="shrink-0 font-mono text-[0.625rem] tabular-nums text-[var(--ui-text-quaternary)]">{formatElapsed(ms)}</span>;
}

export function ToolCalls({ block, streaming, chatId }: { block: ContentBlock; streaming: boolean; isLast: boolean; chatId: string }) {
  const calls = block.toolCalls ?? [];
  const results = block.results ?? [];
  const resultFor = (id: string) => results.find((r) => r.toolCallId === id);
  const rows = contiguousToolRows(calls);

  return (
    <div className="flex flex-col gap-[var(--tool-row-gap)] text-[length:var(--conversation-tool-font-size)]">
      {rows.map((row) => row.kind === "research" ? (
        <ExploredGroup key={row.calls.map((call) => call.id).join(":")} calls={row.calls} results={results} active={streaming} />
      ) : (
        <ToolRow key={row.call.id} call={row.call} result={resultFor(row.call.id)} streaming={streaming} chatId={chatId} />
      ))}
    </div>
  );
}

function contiguousToolRows(calls: ToolCall[]): Array<{ kind: "research"; calls: ToolCall[] } | { kind: "tool"; call: ToolCall }> {
  const rows: Array<{ kind: "research"; calls: ToolCall[] } | { kind: "tool"; call: ToolCall }> = [];
  let research: ToolCall[] = [];
  const flushResearch = () => {
    if (research.length) rows.push({ kind: "research", calls: research });
    research = [];
  };
  for (const call of calls) {
    if (isResearchTool(call.name)) research.push(call);
    else {
      flushResearch();
      rows.push({ kind: "tool", call });
    }
  }
  flushResearch();
  return rows;
}

/**
 * Extracts all file diffs from a message's content blocks.
 * Used by MessageBubble to show the file-change summary.
 */
export function getMessageFileDiffs(blocks: ContentBlock[]): FileDiffEntry[] {
  const allCalls: ToolCall[] = [];
  for (const block of blocks) {
    if (block.type === "tool_calls" && block.toolCalls) {
      allCalls.push(...block.toolCalls);
    }
  }
  return collectFileDiffs(allCalls);
}

/**
 * The Antigravity "N files changed +X -Y · Review" bar shown at the bottom
 * of an assistant message.
 */
export function FileChangeSummary({ diffs, chatId }: { diffs: FileDiffEntry[]; chatId: string }) {
  if (diffs.length === 0) return null;

  const totalAdded = diffs.reduce((sum, d) => sum + d.stats.added, 0);
  const totalRemoved = diffs.reduce((sum, d) => sum + d.stats.removed, 0);

  const openReview = () => {
    useWorkspaceStore.getState().setReviewDiffs(diffs);
    useWorkspaceStore.getState().activate(chatId, "review");
  };

  return (
    <div className="my-1 flex w-full select-none flex-col">
      <div
        onClick={openReview}
        className="flex cursor-pointer flex-wrap items-center justify-between gap-1 rounded-md border border-[var(--ui-stroke-tertiary)] px-3 py-2 text-[length:var(--conversation-tool-font-size)] transition-colors duration-150 hover:bg-[var(--ui-row-hover-background)]"
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          <span className="truncate text-[var(--ui-text-secondary)]">
            {diffs.length} file{diffs.length === 1 ? "" : "s"} changed
          </span>
          <div className="flex items-center gap-1 font-mono text-[0.625rem] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{totalAdded}</span>
            {totalRemoved > 0 && <span className="text-rose-600 dark:text-rose-400">−{totalRemoved}</span>}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openReview();
          }}
          className="flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-md border border-[var(--ui-stroke-tertiary)] px-1.5 py-0.5 text-[var(--ui-text-secondary)] transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-foreground"
        >
          <ReviewIcon className="size-3.5 opacity-70" />
          <span>Review</span>
        </button>
      </div>
    </div>
  );
}

function ReviewIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor" className={className} aria-hidden="true">
      <path d="M510-530h60v-80h80v-60H570v-80H510v80H430v60h80v80ZM430-370H650v-60H430v60ZM332.31-220Q302-220 281-241t-21-51.31V-827.69Q260-858 281-879t51.31-21H610L820-690v397.69Q820-262 799-241t-51.31,21H332.31Zm0-60H747.69q4.62,0 8.46-3.85t3.85-8.46V-660L580-840H332.31q-4.62,0-8.46,3.85T320-827.69v535.38q0,4.62 3.85,8.46t8.46,3.85Zm-160,220Q142-60 121-81t-21-51.31V-660h60v527.69q0,4.62 3.85,8.46t8.46,3.85H580v60H172.31ZM320-280q0,0 0-3.85t0-8.46V-827.69q0-4.62 0-8.46t0-3.85v180v367.69q0,4.62 0,8.46t0,3.85Z" />
    </svg>
  );
}

function ToolRow({ call, result, streaming, chatId }: { call: ToolCall; result?: ToolResult; streaming: boolean; chatId: string }) {
  const name = normalizeToolName(call.name);
  if (name === "switchmode") return <SwitchModeRow call={call} />;
  if (name === "todowrite") return <TodoRow call={call} />;
  if (name === "bash") return <TerminalRow call={call} result={result} />;
  if (["write", "edit", "multiedit", "applypatch", "delete", "move"].includes(name)) return <EditRow call={call} result={result} chatId={chatId} />;
  if (name === "task") return <AgentRow call={call} result={result} parentChatId={chatId} />;
  if (name === "skill") return <SkillRow call={call} result={result} streaming={streaming} />;
  return <GenericRow call={call} result={result} streaming={streaming} />;
}

/** Antigravity file-name chip: Symbols file icon + basename, lightens on hover. */
function FileChip({ path, onClick }: { path: string; onClick?: () => void }) {
  return (
    <span className="context-scope-mention min-w-0">
      <button
        type="button"
        draggable="true"
        onClick={(event) => {
          if (!onClick) return;
          event.stopPropagation();
          onClick();
        }}
        className="appearance-none bg-transparent border-0 p-0 inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-md align-middle text-sm font-medium transition-[opacity,background-color] cursor-pointer hover:bg-secondary select-none translate-y-[-1.5px]"
        style={{ padding: "1px 0.25rem 1px 0.125rem" }}
      >
        <FileSymbolIcon path={path} />
        <span className="inline-flex min-w-0 items-center gap-1 truncate leading-tight select-text">{baseName(path)}</span>
      </button>
    </span>
  );
}

function FolderChip({ path }: { path: string }) {
  return (
    <span className="context-scope-mention min-w-0">
      <span
        className="appearance-none bg-transparent border-0 p-0 inline-flex max-w-full items-center gap-0.5 rounded-md align-middle text-sm font-medium transition-[opacity,background-color] select-none translate-y-[-1.5px]"
        style={{ padding: "1px 0.25rem 1px 0.125rem" }}
      >
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="inline-flex min-w-0 items-center gap-1 truncate leading-tight select-text">{path}</span>
      </span>
    </span>
  );
}

function StatPair({ stats, showZero = false }: { stats: { added: number; removed: number } | null; showZero?: boolean }) {
  if (!stats) return null;
  if (!showZero && stats.added === 0 && stats.removed === 0) return null;
  return (
    <span className="ml-px flex flex-row gap-1 whitespace-nowrap rounded-md px-1 py-0.5 text-xs tabular-nums">
      <span className="text-green-500">+{stats.added}</span>
      {(showZero || stats.removed > 0) && <span className="text-red-500">-{stats.removed}</span>}
    </span>
  );
}

/**
 * The Antigravity compact tool row: a single 32px line that reads
 * "{verb} {detail}", with an optional inline spinner while running, an
 * optional trailing control, and an optional chevron that reveals `body`.
 */
function CompactRow({
  verb,
  error,
  running,
  timer,
  trailing,
  expandable,
  open,
  onToggle,
  onClick,
  children,
  body,
}: {
  verb: React.ReactNode;
  error?: boolean;
  running?: boolean;
  timer?: React.ReactNode;
  trailing?: React.ReactNode;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  children?: React.ReactNode;
  body?: React.ReactNode;
}) {
  const clickable = Boolean(onClick) || (expandable && Boolean(onToggle));

  // Status glyph precedence (mirrors Hermes): a live spinner while running,
  // an alert on error, and SILENT success — a completed row reads as "done"
  // by simply no longer spinning, not by stacking a green checkmark. This is
  // what keeps a long run from looking like a wall of badges.
  const glyph = running ? (
    <Loader2 className="size-3 shrink-0 animate-spin text-[var(--ui-text-tertiary)]" />
  ) : error ? (
    <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
  ) : null;

  return (
    <div className={cn("min-w-0 max-w-full overflow-hidden", open && "rounded-md border border-[var(--ui-stroke-tertiary)]")}>
      <div className={cn("flex w-full items-center", open && "border-b border-[var(--ui-stroke-tertiary)] px-2 py-1.5")}>
        {/* Not a <button> on purpose: the row's children may contain interactive
            chips (FileChip, FolderChip), and a <button> inside a <button> is
            invalid HTML (hydration error). A keyboard-accessible div with the
            right role + key handling is the correct primitive here. */}
        <div
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          aria-disabled={clickable ? undefined : true}
          aria-expanded={expandable ? Boolean(open) : undefined}
          onClick={clickable ? (onClick ?? onToggle) : undefined}
          onKeyDown={
            clickable
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    (onClick ?? onToggle)?.();
                  }
                }
              : undefined
          }
          className={cn(
            "group/row flex min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[length:var(--conversation-tool-font-size)] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[var(--ui-stroke-primary)]",
            clickable ? "cursor-pointer hover:text-foreground" : "cursor-default",
          )}
        >
          {glyph}
          <span className={cn("inline-flex shrink-0 items-center font-medium", error ? "text-destructive" : "text-[var(--ui-text-secondary)]")}>{verb}</span>
          <span className="inline-flex min-w-0 items-center gap-1 truncate leading-tight text-[var(--ui-text-secondary)]">
            {children}
          </span>
          {expandable && (
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-[var(--ui-text-quaternary)] transition-all duration-150",
                open ? "rotate-90 text-[var(--ui-text-tertiary)] opacity-80" : "opacity-0 group-hover/row:opacity-80",
              )}
            />
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {timer}
          {trailing}
        </div>
      </div>

      {expandable && open && body && (
        <div className="w-full min-w-0 overflow-hidden p-1.5">
          <div className="w-full min-w-0 animate-fade-in">{body}</div>
        </div>
      )}
    </div>
  );
}

function ExploredGroup({ calls, results, active }: { calls: ToolCall[]; results: ToolResult[]; active: boolean }) {
  const [open, setOpen] = useState(false);
  const { files, folders } = countExploredItems(calls);
  const webOnly = calls.every((call) => ["webfetch", "websearch"].includes(normalizeToolName(call.name)));
  const lifecycles = calls.map((call) => toolLifecycle(results.find((r) => r.toolCallId === call.id)));
  const failed = lifecycles.some((lifecycle) => lifecycle === "error");
  const running = active && lifecycles.some((lifecycle) => lifecycle === "running");
  const queued = active && !running && lifecycles.some((lifecycle) => lifecycle === "queued");

  useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);

  const parts: string[] = [];
  if (files > 0) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders > 0) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  const folderCalls = calls.filter((call) => normalizeToolName(call.name) === "ls");
  const singleFolderPath = folderCalls.length === 1 ? extractFilePath(folderCalls[0].arguments) || summarizeTool(folderCalls[0].name, folderCalls[0].arguments) : "";
  const verbLabel = webOnly ? (running ? "Searching" : queued ? "Queued search" : "Searched") : (running ? "Exploring" : queued ? "Queued exploration" : "Explored");
  const itemLabel = webOnly ? "the web" : singleFolderPath ? `folder ${singleFolderPath}` : parts.length > 0 ? parts.join(", ") : `${calls.length} item${calls.length === 1 ? "" : "s"}`;

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <button
        onClick={() => setOpen((value) => !value)}
        title="VaultGate read files and web pages to understand your request. Click to see what it looked at."
        className="group/row flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[length:var(--conversation-tool-font-size)] tabular-nums transition-colors hover:text-foreground"
      >
        {running && <Loader2 className="size-3 shrink-0 animate-spin text-[var(--ui-text-tertiary)]" />}
        {queued && <Circle className="size-3 shrink-0 text-[var(--ui-text-quaternary)]" />}
        {failed && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
        <span className={cn("shrink-0 font-medium", failed ? "text-destructive" : "text-[var(--ui-text-secondary)]")}>{verbLabel}</span>
        <span className="truncate text-[var(--ui-text-secondary)]">{itemLabel}</span>
        <ChevronRight className={cn("size-3 shrink-0 text-[var(--ui-text-quaternary)] transition-all duration-150", open ? "rotate-90 text-[var(--ui-text-tertiary)] opacity-80" : "opacity-0 group-hover/row:opacity-80")} />
      </button>
      {open && (
        <div className="overflow-hidden pl-3">
          <div className="flex animate-fade-in flex-col gap-0.5 py-1">
            {calls.map((call) => {
              const result = results.find((r) => r.toolCallId === call.id);
              const fp = extractFilePath(call.arguments);
              const lifecycle = toolLifecycle(result);
              const lines = result?.content.match(/\d+:/g)?.length;
              const preview = recallResultPreview(call, result) || (result?.status === "error" ? resultPreview(result.content, 180) : "");
              return (
                <div key={call.id} className="flex flex-col gap-0.5">
                  <div className="flex min-h-6 items-center gap-1.5 px-1 text-[length:var(--conversation-tool-font-size)] text-[var(--ui-text-secondary)]">
                    {lifecycle === "error" ? (
                      <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                    ) : lifecycle === "running" ? (
                      <Loader2 className="size-3 shrink-0 animate-spin text-[var(--ui-text-tertiary)]" />
                    ) : lifecycle === "queued" ? (
                      <Circle className="size-3 shrink-0 text-[var(--ui-text-quaternary)]" />
                    ) : (
                      <span className="size-1 shrink-0 rounded-full bg-[var(--ui-text-quaternary)]" />
                    )}
                    <span className="shrink-0 text-[var(--ui-text-tertiary)]">{lifecycleLabel(toolDisplaySpec(call.name), lifecycle)}</span>
                    {normalizeToolName(call.name) === "ls" && fp ? <FolderChip path={fp} /> : fp ? <FileChip path={fp} /> : <span className="truncate text-[var(--ui-text-secondary)]">{summarizeTool(call.name, call.arguments)}</span>}
                    {lines ? <span className="text-[var(--ui-text-quaternary)]">#L1-{lines}</span> : null}
                  </div>
                  {preview && <div className={cn("px-1 pl-6 text-[0.7rem]", lifecycle === "error" ? "text-destructive" : "text-[var(--ui-text-tertiary)]")}>{preview}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function recallResultPreview(call: ToolCall, result?: ToolResult): string {
  if (normalizeToolName(call.name) !== "recallsessions" || result?.status !== "completed") return "";
  const firstLine = result.content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  if (!firstLine) return "";
  return resultPreview(firstLine, 220);
}

function findStringField(args: string, keys: string[]): string {
  const parsed = parseJsonLoose(args) || {};
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value) return value;
  }
  for (const key of keys) {
    const value = extractPartialJsonString(args, key);
    if (value) return value;
  }
  return "";
}

function findStringFields(args: string, key: string): string[] {
  const parsed = parseJsonLoose(args) || {};
  const values: string[] = [];

  const collect = (value: unknown) => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") collect((value as Record<string, unknown>)[key]);
  };

  collect(parsed[key]);
  if (Array.isArray(parsed.edits)) {
    for (const edit of parsed.edits) collect((edit as Record<string, unknown>)?.[key]);
  }
  if (values.length > 0) return values;
  return extractPartialJsonStrings(args, key);
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
    const raw = source.slice(quoteAt + 1, end);
    values.push(decodePartialJsonString(raw));
    searchAt = Math.max(end + 1, quoteAt + 1);
  }
  return values.filter(Boolean);
}

function extractPartialJsonString(source: string, key: string): string {
  return extractPartialJsonStrings(source, key)[0] ?? "";
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

function countLines(value: string): number {
  return value ? value.replace(/\r/g, "").split("\n").length : 0;
}

function liveFilePath(args: string): string {
  return findStringField(args, ["filepath", "file_path", "filePath", "path", "relativePath", "relative_path", "source", "destination", "from", "to", "oldPath", "old_path", "newPath", "new_path", "target", "filename"]);
}

function fileActionHint(toolName: string, lifecycle: ToolLifecycle): string {
  const spec = toolDisplaySpec(toolName);
  switch (toolName) {
    case "write": return lifecycle === "completed" ? "new file" : "creating file\u2026";
    case "edit": case "multiedit": return lifecycle === "completed" ? spec.completed : "editing file\u2026";
    case "applypatch": return lifecycle === "completed" ? spec.completed : "patching\u2026";
    case "delete": return lifecycle === "completed" ? spec.completed : "deleting file\u2026";
    case "move": return lifecycle === "completed" ? spec.completed : "moving file\u2026";
    default: return spec[lifecycle];
  }
}
function patchTargetSummary(args: string): string {
  const patch = extractStringField(args, ["patch", "input"]);
  const diffs = collectPatchDiffs(patch);
  if (diffs.length === 0) return "patch";
  if (diffs.length === 1) return diffs[0].filePath;
  return `${diffs.length} files`;
}

function writtenContent(name: string, args: string): string {
  const n = normalizeToolName(name);
  const a = parseJsonLoose(args) || {};
  if (n === "write") return String(a.content ?? findStringField(args, ["content"]));
  if (n === "edit") return String(a.new_str ?? findStringField(args, ["new_str"]));
  if (n === "multiedit") {
    const edits = Array.isArray(a.edits) ? (a.edits as Array<Record<string, unknown>>) : [];
    const parsed = edits.map((e) => String(e?.new_str ?? "")).filter(Boolean);
    return (parsed.length ? parsed : findStringFields(args, "new_str")).join("\n");
  }
  return "";
}

function liveDiffStats(name: string, args: string): { added: number; removed: number } {
  const n = normalizeToolName(name);
  if (n === "write") return { added: countLines(writtenContent(name, args)), removed: 0 };
  if (n === "edit") {
    return {
      added: countLines(writtenContent(name, args)),
      removed: countLines(findStringField(args, ["old_str"])),
    };
  }
  if (n === "multiedit") {
    return {
      added: findStringFields(args, "new_str").reduce((sum, value) => sum + countLines(value), 0),
      removed: findStringFields(args, "old_str").reduce((sum, value) => sum + countLines(value), 0),
    };
  }
  if (n === "applypatch") {
    return collectPatchDiffs(extractStringField(args, ["patch", "input"])).reduce(
      (total, diff) => ({ added: total.added + diff.stats.added, removed: total.removed + diff.stats.removed }),
      { added: 0, removed: 0 },
    );
  }
  return { added: 0, removed: 0 };
}

function EditRow({ call, result, chatId }: { call: ToolCall; result?: ToolResult; chatId: string }) {
  const toolName = normalizeToolName(call.name);
  const directFp = extractFilePath(call.arguments) || liveFilePath(call.arguments);
  const patchSummary = toolName === "applypatch" && !directFp ? patchTargetSummary(call.arguments) : "";
  const fp = directFp || (/^(?:\d+ files|patch)$/.test(patchSummary) ? "" : patchSummary);
  const liveStats = liveDiffStats(call.name, call.arguments);
  const stats = diffStats(call.name, call.arguments) ?? liveStats;
  const lifecycle = toolLifecycle(result);
  const label = lifecycleLabel(toolDisplaySpec(call.name), lifecycle);
  const writeOverwrote = toolName === "write" && /file updated/i.test(result?.content ?? "");
  const resolvedLabel = writeOverwrote ? (lifecycle === "error" ? "Edit failed" : "Edited") : label;
  const writing = lifecycle === "running";
  const pending = lifecycle === "queued";
  const detail = toolName === "applypatch" && !fp ? patchSummary : "";

  const openFile = () => {
    if (!fp) return;
    useWorkspaceStore.getState().activate(chatId, "code");
    const rel = fp.replace(/^\/+/, "");
    const emit = () => {
      window.dispatchEvent(new CustomEvent("vaultgate:open-workspace-path", { detail: rel }));
      window.dispatchEvent(new CustomEvent("vaultgate:open-file", { detail: rel }));
    };
    emit();
    window.setTimeout(emit, 50);
  };

  return <EditedRow call={call} result={result} fp={fp} detail={detail} label={resolvedLabel} stats={stats} liveStats={liveStats} lifecycle={lifecycle} openFile={openFile} writing={writing} pending={pending} toolName={toolName} writeOverwrote={writeOverwrote} />;
}

function EditedRow({
  call,
  result,
  fp,
  detail,
  label,
  stats,
  liveStats,
  lifecycle,
  openFile,
  writing,
  pending,
  toolName,
  writeOverwrote,
}: {
  call: ToolCall;
  result?: ToolResult;
  fp: string;
  detail: string;
  label: string;
  stats: { added: number; removed: number } | null;
  liveStats: { added: number; removed: number };
  lifecycle: ToolLifecycle;
  openFile: () => void;
  writing: boolean;
  pending: boolean;
  toolName: string;
  writeOverwrote: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (lifecycle === "error") setOpen(true);
  }, [lifecycle]);

  const isError = lifecycle === "error";
  const diffHunks = getDiffHunks(call);
  const hasDiff = diffHunks.length > 0 && !diffHunks.every((h) => !h.old && !h.next);
  const body = isError && result?.content ? <ResultPanel content={result.content} /> : hasDiff ? <DiffView hunks={diffHunks} name={normalizeToolName(call.name)} /> : undefined;
  const writingVerb = toolName === "write" ? (writeOverwrote ? "Editing" : "Creating") : toolName === "applypatch" ? "Applying patch" : toolName === "delete" ? "Deleting" : toolName === "move" ? "Moving" : "Editing";
  const verbClass = !writing
    ? undefined
    : toolName === "write" && !writeOverwrote
      ? "text-emerald-600 dark:text-emerald-400"
      : toolName === "write" || toolName === "edit" || toolName === "multiedit"
        ? "text-sky-600 dark:text-sky-400"
        : toolName === "applypatch"
          ? "text-violet-600 dark:text-violet-400"
          : toolName === "delete"
            ? "text-destructive"
            : toolName === "move"
              ? "text-amber-600 dark:text-amber-400"
              : undefined;
  const liveLines = liveStats.added;

  return (
    <CompactRow
      verb={writing ? <span className={verbClass}>{writingVerb}</span> : label}
      error={isError}
      running={writing}
      timer={<ToolTimer call={call} result={result} />}
      expandable={!writing && !pending && Boolean(body)}
      open={!writing && !pending && open}
      onToggle={!writing && !pending ? () => setOpen((v) => !v) : undefined}
      trailing={
        fp ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openFile();
            }}
            title={`Open ${baseName(fp)} in the Code panel`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Code2 className="size-3.5" />
          </button>
        ) : undefined
      }
      body={body}
    >
      {fp ? (
        <FileChip path={fp} onClick={openFile} />
      ) : detail ? (
        <span className="truncate font-mono text-[length:var(--conversation-tool-font-size)] text-[var(--ui-text-secondary)]">
          {detail}
        </span>
      ) : (
        <span className="truncate font-mono text-[length:var(--conversation-tool-font-size)] italic text-[var(--ui-text-tertiary)]">
          {fileActionHint(toolName, lifecycle)}
        </span>
      )}
      {writing ? (
        <span className="ml-1 inline-flex shrink-0 items-center gap-1 font-mono text-[0.7rem] tabular-nums">
          {liveLines > 0 && (
            <span
              className={cn(
                "transition-colors",
                toolName === "write" && "text-emerald-500 dark:text-emerald-400",
                toolName === "edit" || toolName === "multiedit" ? "text-sky-500 dark:text-sky-400" : "",
                toolName === "applypatch" && "text-violet-500 dark:text-violet-400",
              )}
            >
              +{liveLines}
            </span>
          )}
          <span
            aria-hidden
            className={cn(
              "live-caret",
              toolName === "write" && "live-caret-create",
              (toolName === "edit" || toolName === "multiedit") && "live-caret-edit",
              toolName === "applypatch" && "live-caret-patch",
              toolName === "delete" && "live-caret-delete",
              toolName === "move" && "live-caret-move",
            )}
          />
        </span>
      ) : pending ? null : (
        <StatPair stats={stats} showZero />
      )}
    </CompactRow>
  );
}

function getDiffHunks(call: ToolCall): { old: string; next: string }[] {
  const name = normalizeToolName(call.name);
  const a = parseJsonLoose(call.arguments) || {};
  const hunks: { old: string; next: string }[] = [];
  if (name === "write") hunks.push({ old: "", next: String(a.content ?? findStringField(call.arguments, ["content"])) });
  else if (name === "edit") hunks.push({ old: String(a.old_str ?? findStringField(call.arguments, ["old_str"])), next: String(a.new_str ?? findStringField(call.arguments, ["new_str"])) });
  else if (name === "multiedit") {
    for (const e of Array.isArray(a.edits) ? (a.edits as Array<Record<string, unknown>>) : []) hunks.push({ old: String(e?.old_str ?? ""), next: String(e?.new_str ?? "") });
  } else if (name === "applypatch") {
    for (const entry of collectPatchDiffs(extractStringField(call.arguments, ["patch", "input"]))) hunks.push(...entry.hunks);
  }
  return hunks;
}

function DiffView({ hunks, name }: { hunks: { old: string; next: string }[]; name: string }) {
  if (hunks.length === 0 || hunks.every((h) => !h.old && !h.next)) return null;

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent">
      <div className="border-b border-[var(--ui-stroke-tertiary)] px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--ui-text-tertiary)]">{name === "write" ? "new file" : `${hunks.length} change${hunks.length > 1 ? "s" : ""}`}</div>
      <div className="max-h-80 min-w-0 overflow-auto py-1 font-mono text-[11.5px] leading-relaxed text-[var(--ui-text-secondary)]">
        {hunks.map((h, hi) => (
          <div key={hi} className={hi > 0 ? "mt-1 border-t border-[var(--ui-stroke-quaternary)] pt-1" : ""}>
            <DiffHunk rows={collapseContext(lineDiff(h.old, h.next))} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single hunk rendered as real diff rows: context lines neutral, only changed
 * lines tinted. Long unmodified runs are elided to keep the card focused. */
function DiffHunk({ rows }: { rows: Array<DiffRow | { type: "gap"; count: number }> }) {
  return (
    <>
      {rows.map((row, i) => {
        if (row.type === "gap") {
          return (
            <div key={`g${i}`} className="select-none px-2 py-0.5 text-[10.5px] text-muted-foreground/60">
              ⋯ {row.count} unchanged line{row.count === 1 ? "" : "s"}
            </div>
          );
        }
        const sign = row.type === "add" ? "+" : row.type === "remove" ? "-" : " ";
        return (
          <div
            key={`r${i}`}
            className={cn(
              "flex whitespace-pre-wrap break-words px-2",
              row.type === "add" && "diff-line-added",
              row.type === "remove" && "diff-line-removed",
            )}
          >
            <span
              className={cn(
                "diff-gutter mr-2 select-none",
                row.type === "add" ? "text-emerald-400/60" : row.type === "remove" ? "text-red-400/60" : "text-muted-foreground/40",
              )}
            >
              {sign}
            </span>
            <span className="min-w-0">{row.text ? <HiLine code={row.text} /> : " "}</span>
          </div>
        );
      })}
    </>
  );
}

/** Collapse runs of >6 unchanged context lines into a single elision marker,
 * keeping 3 lines of context on each side of every change. */
function collapseContext(rows: DiffRow[], pad = 3): Array<DiffRow | { type: "gap"; count: number }> {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "context") continue;
    for (let j = Math.max(0, i - pad); j <= Math.min(rows.length - 1, i + pad); j++) keep[j] = true;
  }
  const out: Array<DiffRow | { type: "gap"; count: number }> = [];
  let hidden = 0;
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) {
      if (hidden > 0) {
        out.push({ type: "gap", count: hidden });
        hidden = 0;
      }
      out.push(rows[i]);
    } else {
      hidden++;
    }
  }
  if (hidden > 0) out.push({ type: "gap", count: hidden });
  return out;
}

function TerminalRow({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const [open, setOpen] = useState(false);
  const args = parseJsonLoose(call.arguments) || {};
  const command = String(args.command || summarizeTool(call.name, call.arguments));
  const lifecycle = toolLifecycle(result);
  const failed = lifecycle === "error";
  const label = lifecycleLabel(toolDisplaySpec(call.name), lifecycle);

  useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);

  return (
    <CompactRow
      verb={label}
      error={failed}
      running={lifecycle === "running"}
      timer={<ToolTimer call={call} result={result} />}
      expandable={Boolean(result?.content)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      body={result?.content ? <CommandOutput command={command} content={result.content} /> : undefined}
    >
      <span className="inline-flex min-w-0 max-w-full">
        <span className="truncate font-mono text-[0.75rem]">{command}</span>
      </span>
    </CompactRow>
  );
}

function CommandOutput({ command, content }: { command: string; content: string }) {
  const appServer = extractAppServerInfo(content);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {appServer && <AppServerCard info={appServer} />}
      <div className="flex min-w-0 max-w-full flex-col overflow-hidden rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent">
        <div className="flex min-w-0 grow items-start justify-between border-b border-[var(--ui-stroke-tertiary)] px-2.5 py-1">
          <pre className="max-h-[120px] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[0.7rem] leading-relaxed text-[var(--ui-text-secondary)]">
            <span className="text-[var(--ui-text-quaternary)]">…/workspace</span>
            <span className="text-[var(--ui-text-quaternary)]"> &gt; </span>
            {command}
          </pre>
        </div>
        <div className="max-h-[260px] min-w-0 overflow-auto px-2.5 py-1">
          <TerminalOutput chunks={[stripAnsi(content)]} compact />
        </div>
      </div>
    </div>
  );
}

interface AppServerInfo {
  url: string;
  project?: string;
  log?: string;
  status?: string;
}

function firstLineValue(content: string, label: string): string | undefined {
  const match = new RegExp(`^${label}:\\s*(.+)$`, "im").exec(content);
  return match?.[1]?.trim() || undefined;
}

function extractAppServerInfo(content: string): AppServerInfo | null {
  const clean = stripAnsi(content);
  const match = /^App:\s*(https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s]*)/im.exec(clean);
  if (!match) return null;
  return {
    url: match[1],
    project: firstLineValue(clean, "Project"),
    log: firstLineValue(clean, "Log"),
    status: firstLineValue(clean, "Status"),
  };
}

function AppServerCard({ info }: { info: AppServerInfo }) {
  const open = () => window.open(info.url, "_blank", "noopener,noreferrer");
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 rounded-md bg-primary/10 p-1 text-primary">
            <Server className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">App server</div>
            <a className="block truncate font-mono text-xs text-primary hover:underline" href={info.url} target="_blank" rel="noreferrer">
              {info.url}
            </a>
          </div>
        </div>
        <button type="button" onClick={open} className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted">
          Open
          <ExternalLink className="size-3" />
        </button>
      </div>
      {(info.project || info.status || info.log) && (
        <div className="mt-2 grid gap-0.5 pl-8 text-xs text-muted-foreground">
          {info.status && <div className="truncate">{info.status}</div>}
          {info.project && <div className="truncate">Project: {info.project}</div>}
          {info.log && <div className="truncate">Log: {info.log}</div>}
        </div>
      )}
    </div>
  );
}

function SkillRow({ call, result, streaming }: { call: ToolCall; result?: ToolResult; streaming: boolean }) {
  const lifecycle = toolLifecycle(result);
  const [open, setOpen] = useState(false);
  const args = parseJsonLoose(call.arguments) || {};
  const skillName = String(args.command || summarizeTool(call.name, call.arguments));

  useEffect(() => {
    if (lifecycle === "error") setOpen(true);
    if (normalizeToolName(call.name) === "bashoutput" && result?.content) setOpen(true);
  }, [call.name, lifecycle, result?.content]);

  return (
    <CompactRow
      verb={lifecycleLabel(toolDisplaySpec(call.name), lifecycle)}
      error={lifecycle === "error"}
      running={streaming && lifecycle === "running"}
      timer={<ToolTimer call={call} result={result} />}
      expandable={Boolean(result?.content)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      body={result?.content ? <ResultPanel content={result.content} /> : undefined}
    >
      {lifecycle !== "error" && <Wand2 className={cn("size-3.5 shrink-0", lifecycle === "completed" ? "text-fuchsia-400" : "text-fuchsia-400/70")} />}
      <span className="truncate font-medium text-foreground/90">{skillName}</span>
    </CompactRow>
  );
}

function AgentRow({ call, result, parentChatId }: { call: ToolCall; result?: ToolResult; parentChatId: string }) {
  const lifecycle = toolLifecycle(result);
  const args = parseJsonLoose(call.arguments) || {};
  const type = String(args.subagent_type || "general");
  const description = String(args.description || summarizeTool(call.name, call.arguments));
  const selectChat = useChatStore((s) => s.selectChat);
  const upsertChat = useChatStore((s) => s.upsertChat);
  const parentModel = useChatStore((s) => s.chats.find((chat) => chat.id === parentChatId)?.model ?? "");
  const parentReport = useChatStore((s) => (s.messagesByChat[parentChatId] ?? []).find((message) => message.id === `${call.id}-parent-report`));
  const backgroundStarted = result?.content.includes("Started sub-agent in background") ?? false;
  const displayLifecycle = parentReport ? (parentReport.status === "error" ? "error" : "completed") : lifecycle;
  const active = lifecycle === "running" || (backgroundStarted && !parentReport);

  const handleCardClick = () => {
    upsertChat({ id: call.id, title: description, model: parentModel, parentId: parentChatId, type: "subagent", createdAt: Date.now(), updatedAt: Date.now() });
    void selectChat(call.id);
  };

  const getSubTitle = () => {
    if (parentReport) return parentReportSummary(parentReport.content, parentReport.status);
    if (lifecycle === "queued") return "Invoking subagent...";
    if (lifecycle === "running") return `Invoked ${type} subagent`;
    if (lifecycle === "error") return "Sub-agent execution failed";
    if (backgroundStarted) return `Running ${type} subagent in background`;
    return `Completed ${type} subagent`;
  };

  return (
    <div className="flex w-full min-w-0 flex-col">
      <div
        onClick={handleCardClick}
        className="group flex w-full min-w-0 cursor-pointer select-none flex-col gap-1 overflow-hidden rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent px-2.5 py-1.5 transition-colors hover:bg-[var(--ui-row-hover-background)]"
      >
        <div className="flex w-full min-w-0 items-center justify-between">
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-[length:var(--conversation-tool-font-size)] font-medium">
            <span className={cn("inline-flex shrink-0 items-center", displayLifecycle === "error" ? "text-destructive" : "text-[var(--ui-text-secondary)]")}>
              {active ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              ) : displayLifecycle === "error" ? (
                <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
              ) : (
                <Bot className="size-3.5 shrink-0 text-[var(--ui-text-tertiary)]" />
              )}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 truncate leading-tight text-[var(--ui-text-secondary)]">
              {description}
            </span>
          </span>

          <div className="flex shrink-0 items-center gap-2">
            <ToolTimer call={call} result={result} />
            <ChevronRight className="size-3 shrink-0 text-[var(--ui-text-quaternary)] transition-colors group-hover:text-[var(--ui-text-tertiary)]" />
          </div>
        </div>
        <div className="min-w-0 pl-5">
          <span className="block truncate text-[0.7rem] text-[var(--ui-text-tertiary)]">{getSubTitle()}</span>
        </div>
      </div>
    </div>
  );
}

function parentReportSummary(content: string, status: ToolResult["status"] | Message["status"]): string {
  const firstLine = content.split("\n", 1)[0]?.trim();
  const match = /^Sub-agent (finished|failed|timed out|was stopped):/i.exec(firstLine || "");
  if (match) return `Sub-agent ${match[1].toLowerCase()}`;
  return status === "error" ? "Sub-agent failed or stopped" : "Sub-agent finished";
}

function GenericRow({ call, result, streaming }: { call: ToolCall; result?: ToolResult; streaming: boolean }) {
  const lifecycle = toolLifecycle(result);
  const [open, setOpen] = useState(false);
  const label = toolActionLabel(call.name, call.arguments, lifecycle);
  const summary = summarizeTool(call.name, call.arguments);

  useEffect(() => {
    if (lifecycle === "error") setOpen(true);
  }, [lifecycle]);

  return (
    <CompactRow
      verb={label}
      error={lifecycle === "error"}
      running={streaming && lifecycle === "running"}
      timer={<ToolTimer call={call} result={result} />}
      expandable={Boolean(result?.content)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      body={result?.content ? <ResultPanel content={result.content} /> : undefined}
    >
      {summary && <span className="min-w-0 truncate font-medium text-foreground/80">{summary}</span>}
    </CompactRow>
  );
}

function ResultPanel({ content }: { content: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent">
      <div className="border-b border-[var(--ui-stroke-tertiary)] px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-[var(--ui-text-tertiary)]">tool result</div>
      <div className="max-h-[260px] min-w-0 overflow-auto px-2.5 py-1">
        <TerminalOutput chunks={[stripAnsi(content)]} compact />
      </div>
    </div>
  );
}

function SwitchModeRow({ call }: { call: ToolCall }) {
  const args = parseJsonLoose(call.arguments) || {};
  const target = String(args.mode || "").toLowerCase();
  const def = isChatMode(target) ? modeDef(target) : null;
  const Icon = def?.icon ?? Sparkles;
  return (
    <div className="flex min-h-6 items-center gap-1.5 px-1 py-0.5 text-[length:var(--conversation-tool-font-size)]">
      <Icon className="size-3.5 shrink-0" style={def ? { color: def.accent } : undefined} />
      <span className="text-[var(--ui-text-tertiary)]">Switched to</span>
      <span className="font-medium text-foreground">{def?.label ?? (target || "a")} mode</span>
    </div>
  );
}

function TodoRow({ call }: { call: ToolCall }) {
  const todos: Todo[] = parseTodos(call.arguments);
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className="w-full min-w-0 max-w-xl overflow-hidden rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent">
      <div className="flex items-center gap-2 border-b border-[var(--ui-stroke-tertiary)] px-3 py-1.5 text-[length:var(--conversation-tool-font-size)] font-medium text-[var(--ui-text-secondary)]">
        <Check className="size-3.5" />
        Tasks
        <span className="ml-auto font-mono text-[0.65rem] tabular-nums text-[var(--ui-text-tertiary)]">{done}/{todos.length}</span>
      </div>
      <div className="px-3 py-1.5">
        {todos.map((todo, index) => (
          <div key={`${todo.id || "todo"}-${index}`} className="flex items-center gap-2 py-1 text-[length:var(--conversation-tool-font-size)]">
            {todo.status === "completed" ? (
              <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : todo.status === "in_progress" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <Circle className="size-3 shrink-0 text-[var(--ui-text-quaternary)]" />
            )}
            <span className={cn("min-w-0 break-words", todo.status === "completed" ? "text-[var(--ui-text-tertiary)] line-through" : "text-[var(--ui-text-secondary)]")}>{todo.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
