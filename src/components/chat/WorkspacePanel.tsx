"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  RefreshCw,
  Check,
  TerminalSquare,
  Folder,
  FolderOpen,
  ChevronRight,
  GitCompareArrows,
  Copy,
  Columns2,
  List,
  ChevronsUpDown,
  Search,
  PanelRight,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { EMPTY_TERMINAL_LINES, useWorkspaceStore, type TerminalEntry, type WorkspaceTab } from "@/lib/store/workspace-store";
import { cn } from "@/lib/utils";
import { FilePreview, previewKindForPath, type FilePreviewState } from "./FilePreview";
import { TerminalOutput } from "./TerminalOutput";
import { baseName, type FileDiffEntry } from "@/lib/ai/tool-display";
import { HiLine } from "./CodeHighlight";
import { FileSymbolIcon } from "@/components/icons/FileSymbolIcon";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

interface WorkspaceTreeResponse {
  tree?: FileNode[];
  rootDir?: string;
  rootName?: string;
  error?: string;
}

export function WorkspacePanel({ chatId }: { chatId: string }) {
  const tab = useWorkspaceStore((s) => s.tab);
  const setTab = useWorkspaceStore((s) => s.setTab);
  const closePanel = useWorkspaceStore((s) => s.closePanel);
  const workspaceToken = useWorkspaceStore((s) => s.workspaceToken);
  const bumpWorkspace = useWorkspaceStore((s) => s.bumpWorkspace);
  const reviewDiffs = useWorkspaceStore((s) => s.reviewDiffs);
  const [reviewUpdated, setReviewUpdated] = useState(false);
  const lastReviewSignature = useRef("");

  const tabs: { id: WorkspaceTab; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: "code", label: "Workspace", icon: <FolderOpen className="size-3.5" />, hint: "Project files. VaultGate runtime, uploads, downloads, and artifacts stay in VaultGate Home." },
    { id: "terminal", label: "Terminal", icon: <TerminalSquare className="size-3.5" />, hint: "The commands VaultGate ran and their output." },
    { id: "review", label: "Review", icon: <GitCompareArrows className="size-3.5" />, hint: "Review all file changes with a unified diff view." },
  ];
  const activeTab: WorkspaceTab = tabs.some((t) => t.id === tab) ? tab : "code";

  useEffect(() => {
    const signature = reviewDiffs.map((diff) => `${diff.filePath}:${diff.stats.added}:${diff.stats.removed}:${diff.hunks.length}`).join("|");
    if (!signature || signature === lastReviewSignature.current) return;
    lastReviewSignature.current = signature;
    if (activeTab === "review") return;
    setReviewUpdated(true);
    const timeout = window.setTimeout(() => setReviewUpdated(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [activeTab, reviewDiffs]);

  return (
    <div className="flex h-full flex-col bg-[var(--ui-bg-sidebar)] text-foreground">
      <div className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-sidebar)] px-2">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                activeTab === t.id ? "bg-[var(--ui-control-active-background)] text-foreground" : "text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-foreground",
                t.id === "review" && reviewUpdated && "bg-primary/10 text-primary ring-1 ring-primary/25",
              )}
            >
              {t.icon}
              {t.label}
              {t.id === "review" && reviewDiffs.length > 0 && (
                <span className={cn("flex size-4 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold tabular-nums text-primary", reviewUpdated && "animate-pulse") }>
                  {reviewDiffs.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={bumpWorkspace} className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-foreground" title="Refresh panel">
            <RefreshCw className="size-3.5" />
          </button>
          <button onClick={closePanel} className="flex size-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-foreground" title="Close">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "code" && <CodeTab chatId={chatId} token={workspaceToken} />}
        {activeTab === "terminal" && <TerminalTab chatId={chatId} />}
        {activeTab === "review" && <ReviewTab diffs={reviewDiffs} />}
      </div>
    </div>
  );
}

function TerminalTab({ chatId }: { chatId: string }) {
  const entries = useWorkspaceStore((s) => s.terminalByChat[chatId] ?? EMPTY_TERMINAL_LINES);
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  // User-vs-programmatic scroll: only snap to bottom when the user was
  // already following along; if they scrolled up to read older output,
  // don't yank them back down mid-stream.
  useEffect(() => {
    const root = endRef.current?.parentElement;
    if (!root) return;
    const onScroll = () => {
      const distance = root.scrollHeight - root.scrollTop - root.clientHeight;
      stickRef.current = distance < 80;
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  const groups = terminalGroups(entries);
  const runningGroups = groups.filter((group) => !group.id || isGroupActive(entries, group.id));

  const copyAll = async () => {
    const text = groups.map((g) => terminalGroupDisplay(g).chunks.join("")).join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAt(Date.now());
      window.setTimeout(() => setCopiedAt((t) => (t === copiedAt ? null : t)), 1400);
    } catch {
      /* clipboard not available */
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--ui-bg-chrome)] text-foreground">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--ui-stroke-tertiary)] px-3 text-[length:var(--conversation-tool-font-size)] text-[var(--ui-text-tertiary)]">
        <span className="font-mono uppercase tracking-[0.08em]">Terminal</span>
        <div className="flex items-center gap-2">
          {runningGroups.length > 0 && (
            <span className="flex items-center gap-1 text-[var(--ui-text-tertiary)]">
              <Loader2 className="size-3 animate-spin" />
              running · {runningGroups.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => void copyAll()}
            disabled={groups.length === 0}
            className="rounded-md border border-[var(--ui-stroke-tertiary)] px-1.5 py-0.5 transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            title="Copy terminal output"
          >
            <span className="font-mono text-[0.7rem]">{copiedAt ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2">
        {groups.length === 0 ? (
          <div className="mx-3 flex h-full items-center justify-center rounded-md border border-dashed border-[var(--ui-stroke-tertiary)] p-4">
            <div className="text-center text-[length:var(--conversation-tool-font-size)] text-[var(--ui-text-tertiary)]">
              <p className="font-medium text-[var(--ui-text-secondary)]">No terminal output yet</p>
              <p className="mt-1">Streamed output from Bash / BashOutput / background tasks appears here in order.</p>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-2 px-2.5">
            {groups.map((group, index) => (
              <TerminalGroup key={(group.id || "terminal") + "-" + index} group={group} entries={entries} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function TerminalGroup({ group, entries }: { group: { id?: string; chunks: string[] }; entries: TerminalEntry[] }) {
  const display = terminalGroupDisplay(group);
  const running = !group.id || isGroupActive(entries, group.id);
  const exitLabel = display.exitCode !== undefined ? (display.exitCode === 0 ? "ok" : `exit ${display.exitCode}`) : undefined;
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  // Collapsed by default only for finished, successful, noisy groups so the tab
  // stays scannable; running groups and failures stay open.
  const [collapsed, setCollapsed] = useState(false);
  const hasOutput = display.chunks.join("").trim().length > 0;

  const copy = async () => {
    if (!hasOutput) return;
    try {
      await navigator.clipboard.writeText(display.chunks.join(""));
      setCopiedAt(Date.now());
      window.setTimeout(() => setCopiedAt(null), 1400);
    } catch {
      /* clipboard not available */
    }
  };

  const showOutput = hasOutput && !collapsed;

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-[length:var(--conversation-tool-font-size)] text-[var(--ui-text-tertiary)]">
        <button
          type="button"
          onClick={() => hasOutput && setCollapsed((v) => !v)}
          disabled={!hasOutput}
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-[var(--ui-text-quaternary)] transition-colors hover:text-foreground disabled:opacity-40"
          title={collapsed ? "Expand output" : "Minimize output"}
          aria-label={collapsed ? "Expand output" : "Minimize output"}
          aria-expanded={hasOutput ? showOutput : undefined}
        >
          {hasOutput ? (
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", showOutput && "rotate-90")} />
          ) : (
            <span className="font-mono text-[0.7rem] font-semibold text-primary">$</span>
          )}
        </button>
        <p className="min-w-0 flex-1 truncate font-mono text-foreground" title={display.title}>{display.title || "(no command)"}</p>
        {running ? (
          <span className="flex items-center gap-1 text-[var(--ui-text-tertiary)]">
            <Loader2 className="size-3 animate-spin" />
            <span className="font-mono text-[0.7rem]">running</span>
          </span>
        ) : exitLabel ? (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.06em]",
              display.exitCode === 0
                ? "text-[var(--ui-text-tertiary)]"
                : "border border-rose-500/30 text-rose-600 dark:text-rose-400",
            )}
          >
            {exitLabel}
          </span>
        ) : null}
        {display.outputLineCount > 0 && (
          <span className="hidden font-mono text-[0.65rem] text-[var(--ui-text-tertiary)] sm:inline">{display.outputLineCount} line{display.outputLineCount === 1 ? "" : "s"}</span>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!hasOutput}
          className="rounded-md border border-[var(--ui-stroke-tertiary)] px-1.5 py-0.5 transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          title="Copy output"
        >
          <span className="font-mono text-[0.7rem]">{copiedAt ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {showOutput && (
        <div className="min-w-0 overflow-hidden border-t border-[var(--ui-stroke-tertiary)]">
          <TerminalOutput chunks={display.chunks} emptyLabel="Awaiting output…" />
        </div>
      )}
    </section>
  );
}

function isGroupActive(entries: TerminalEntry[], id: string): boolean {
  // Background/no-id streams are always considered live. For per-call streams,
  // "live" means the last entry in the group is the most-recent overall entry —
  // matching the agent.ts stream loop, which appends chunks continuously until
  // the tool result lands.
  if (!id) return true;
  for (let i = entries.length - 1; i >= 0; i--) {
    if ((entries[i].id ?? "") === id) return i === entries.length - 1;
  }
  return false;
}

function terminalGroups(entries: TerminalEntry[]): Array<{ id?: string; chunks: string[] }> {
  const groups: Array<{ id?: string; chunks: string[] }> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.id === entry.id) last.chunks.push(entry.chunk);
    else groups.push({ id: entry.id, chunks: [entry.chunk] });
  }
  return groups;
}

function terminalGroupDisplay(group: { id?: string; chunks: string[] }): { title: string; chunks: string[]; outputLineCount: number; exitCode?: number; timeout?: boolean } {
  const text = group.chunks.join("").replace(/\r/g, "");
  const lines = text.split("\n");
  const promptLineIndex = lines.findIndex((line) => /…\/[^\s>]*\s*>|^\$\s/.test(line));
  const promptLine = promptLineIndex >= 0 ? lines[promptLineIndex] : undefined;
  const commandMatch = promptLine?.match(/^(?:.…\/[^\s>]*\s*>|>\s?|\$\s?)(.*)$/);
  const command = commandMatch ? commandMatch[1].trim() : "";
  const outputLines = promptLineIndex >= 0 ? [...lines.slice(0, promptLineIndex), ...lines.slice(promptLineIndex + 1)] : lines;
  const output = outputLines.join("\n").replace(/\s+$/g, "");
  const title = command || "Terminal output";

  // Detect any exit / timeout marker the agent appends after the command body:
  // the model-facing result already includes "Exit code: N" / "Command timed out"
  // when runBash() detects them, so we surface the same info on the group.
  const exitMatch = /\bExit code:\s*(\d+)\b/.exec(text);
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : undefined;
  const timeout = /\bCommand timed out\b/.test(text);

  return {
    title: title.length > 160 ? `${title.slice(0, 157)}...` : title,
    chunks: output ? [`${output}\n`] : [],
    outputLineCount: output ? output.split("\n").length : 0,
    exitCode,
    timeout,
  };
}

/* ────────────────────────────────────────────────────────────
 * Review Tab — world-class diff viewer
 * Shows all file changes aggregated, with green/red line diffs.
 * ──────────────────────────────────────────────────────────── */
type DiffMode = "unified" | "split";

type LineOp =
  | { kind: "context"; text: string; oldLine: number; newLine: number }
  | { kind: "removed"; text: string; oldLine: number }
  | { kind: "added"; text: string; newLine: number };

type SplitRow =
  | { kind: "context"; oldText: string; newText: string; oldLine: number; newLine: number }
  | { kind: "changed"; oldText?: string; newText?: string; oldLine?: number; newLine?: number }
  | { kind: "removed"; oldText: string; oldLine: number }
  | { kind: "added"; newText: string; newLine: number };

type GapRow = { kind: "gap"; hidden: number };

function ReviewTab({ diffs }: { diffs: FileDiffEntry[] }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<DiffMode>("unified");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only reset the expanded/search view when the *set of files* changes — not on
  // every content update — so a live edit to an already-open file doesn't
  // collapse the diff the user is reading mid-stream.
  const fileSetSignature = diffs.map((d) => d.filePath).join("|");
  useEffect(() => {
    setExpandedFiles(new Set());
    setQuery("");
  }, [fileSetSignature]);

  const matchCount = useMemo(() => countDiffMatches(diffs, query), [diffs, query]);

  if (diffs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] p-5 text-sm text-muted-foreground">
          <GitCompareArrows className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium text-foreground">No changes to review</p>
          <p className="mt-1">Generated file changes update here automatically after edits.</p>
        </div>
      </div>
    );
  }

  const allOpen = diffs.length > 0 && expandedFiles.size === diffs.length;

  const toggleFile = (fp: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const toggleAll = () => {
    setExpandedFiles(allOpen ? new Set() : new Set(diffs.map((d) => d.filePath)));
  };

  const copyDiff = async () => {
    await navigator.clipboard.writeText(formatUnifiedDiff(diffs));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="flex h-full flex-col bg-[#0b0b0c] text-zinc-100">
      <div className="flex h-11 shrink-0 items-center border-b border-[#1a1b1e] px-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em] text-zinc-100">Review Changes</h2>
        <div className="ml-auto flex items-center gap-1">
          <ReviewIconButton title="Copy diff" active={copied} onClick={() => void copyDiff()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </ReviewIconButton>
          <ReviewIconButton title={mode === "split" ? "Show unified diff" : "Show side-by-side diff"} active={mode === "split"} onClick={() => setMode((value) => (value === "split" ? "unified" : "split"))}>
            {mode === "split" ? <List className="size-3.5" /> : <Columns2 className="size-3.5" />}
          </ReviewIconButton>
          <ReviewIconButton title={allOpen ? "Collapse All" : "Expand All"} active={allOpen} onClick={toggleAll}>
            <ChevronsUpDown className="size-3.5" />
          </ReviewIconButton>
          <ReviewIconButton title="Find" active={searchOpen} onClick={() => setSearchOpen((value) => !value)}>
            <Search className="size-3.5" />
          </ReviewIconButton>
          <ReviewIconButton title="Toggle Sidebar" active={sideOpen} onClick={() => setSideOpen((value) => !value)}>
            <PanelRight className="size-3.5" />
          </ReviewIconButton>
        </div>
      </div>

      {searchOpen && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#17181a] px-2">
          <div className="flex min-w-0 flex-1 items-center rounded-[4px] bg-[#1b1d22] px-2 text-xs text-zinc-300 ring-1 ring-white/[0.03]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
              placeholder="Find"
              className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 outline-none placeholder:text-zinc-400"
            />
            <span className="ml-2 text-[10px] font-semibold text-zinc-500">Aa</span>
            <span className="ml-2 text-[10px] font-semibold text-zinc-500 underline">ab</span>
            <span className="ml-2 text-[11px] font-semibold text-zinc-500">.*</span>
          </div>
          <span className="w-20 shrink-0 text-xs text-zinc-500">{query.trim() ? `${matchCount} result${matchCount === 1 ? "" : "s"}` : "No results"}</span>
          <button className="rounded p-1 text-zinc-600 hover:text-zinc-300" title="Previous result">
            <ChevronUp className="size-3.5" />
          </button>
          <button className="rounded p-1 text-zinc-600 hover:text-zinc-300" title="Next result">
            <ChevronDown className="size-3.5" />
          </button>
          <button onClick={() => setSearchOpen(false)} className="rounded p-1 text-zinc-500 hover:text-zinc-200" title="Close find">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto scrollbar-none px-2 py-3">
          <div className="space-y-2">
            {diffs.map((entry) => (
              <ReviewFile
                key={entry.filePath}
                entry={entry}
                open={expandedFiles.has(entry.filePath)}
                mode={mode}
                query={query}
                onToggle={() => toggleFile(entry.filePath)}
              />
            ))}
          </div>
        </div>

        {sideOpen && <ReviewSidebar diffs={diffs} expandedFiles={expandedFiles} onSelect={toggleFile} />}
      </div>
    </div>
  );
}

function formatUnifiedDiff(diffs: FileDiffEntry[]): string {
  return diffs
    .map((entry) => {
      const hunks = entry.hunks
        .map((hunk) => {
          const removed = hunk.old ? hunk.old.replace(/\r/g, "").split("\n").map((line) => `-${line}`) : [];
          const added = hunk.next ? hunk.next.replace(/\r/g, "").split("\n").map((line) => `+${line}`) : [];
          return ["@@", ...removed, ...added].join("\n");
        })
        .join("\n");
      return [`--- a/${entry.filePath}`, `+++ b/${entry.filePath}`, hunks].join("\n");
    })
    .join("\n\n");
}

function ReviewIconButton({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-[#1b1c20] hover:text-zinc-200",
        active && "bg-[#1d1f23] text-zinc-100 ring-1 ring-zinc-600/60",
      )}
    >
      {children}
    </button>
  );
}

function ReviewFile({ entry, open, mode, query, onToggle }: { entry: FileDiffEntry; open: boolean; mode: DiffMode; query: string; onToggle: () => void }) {
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());
  const dir = dirName(entry.filePath);

  useEffect(() => {
    setExpandedHunks(new Set());
  }, [entry.filePath, mode]);

  const expandHunk = (index: number) => {
    setExpandedHunks((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-[#1b1d20] bg-[#0b0b0c] shadow-[0_0_0_1px_rgba(255,255,255,0.015)]">
      <button onClick={onToggle} className="flex h-[38px] w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-white/[0.025]">
        <FileBadge path={entry.filePath} />
        <span className="min-w-0 truncate font-medium text-zinc-100">{baseName(entry.filePath)}</span>
        {dir && <span className="min-w-0 truncate text-xs text-zinc-500">{dir}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums">
          <span className="text-green-500">+{entry.stats.added}</span>
          {entry.stats.removed > 0 && <span className="text-red-500">-{entry.stats.removed}</span>}
        </span>
        <ChevronRight className={cn("size-3.5 shrink-0 text-zinc-500 transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <div className="border-t border-[#1a1b1f] bg-[#0a0a0b] font-mono text-[12px] leading-[1.55] text-zinc-300">
          {entry.hunks.map((hunk, index) => (
            <HunkView
              key={index}
              hunk={hunk}
              mode={mode}
              query={query}
              expanded={expandedHunks.has(index)}
              onExpand={() => expandHunk(index)}
              separated={index > 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HunkView({ hunk, mode, query, expanded, onExpand, separated }: { hunk: { old: string; next: string }; mode: DiffMode; query: string; expanded: boolean; onExpand: () => void; separated: boolean }) {
  const ops = buildLineOps(hunk.old, hunk.next);
  if (mode === "split") {
    const visibleRows = collapseRows(buildSplitRows(ops), expanded);
    return (
      <div className={cn(separated && "border-t border-[#202126]")}>
        <SplitDiff rows={visibleRows} query={query} onExpand={onExpand} />
      </div>
    );
  }

  const visibleRows = collapseRows(ops, expanded);

  return (
    <div className={cn(separated && "border-t border-[#202126]")}>
      <UnifiedDiff rows={visibleRows} query={query} onExpand={onExpand} />
    </div>
  );
}

function UnifiedDiff({ rows, query, onExpand }: { rows: Array<LineOp | GapRow>; query: string; onExpand: () => void }) {
  return (
    <div className="py-1">
      {rows.map((row, index) => {
        if (row.kind === "gap") return <DiffGap key={`gap-${index}`} hidden={row.hidden} onExpand={onExpand} />;
        const removed = row.kind === "removed";
        const added = row.kind === "added";
        return (
          <div key={index} className={cn("review-line flex min-h-[22px]", removed && "diff-line-removed", added && "diff-line-added")}>
            <span className="review-gutter select-none">{"oldLine" in row ? row.oldLine : ""}</span>
            <span className="review-gutter select-none">{"newLine" in row ? row.newLine : ""}</span>
            <span className={cn("diff-gutter select-none", removed && "text-[#ff6b6b]", added && "text-[#77d66b]")}>{removed ? "-" : added ? "+" : ""}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-4"><CodeText text={row.text} query={query} /></span>
          </div>
        );
      })}
    </div>
  );
}

function SplitDiff({ rows, query, onExpand }: { rows: Array<SplitRow | GapRow>; query: string; onExpand: () => void }) {
  return (
    <div className="py-1">
      {rows.map((row, index) => {
        if (row.kind === "gap") return <DiffGap key={`gap-${index}`} hidden={row.hidden} onExpand={onExpand} split />;
        const oldChanged = row.kind === "removed" || row.kind === "changed";
        const newChanged = row.kind === "added" || row.kind === "changed";
        const oldText = "oldText" in row ? row.oldText : undefined;
        const newText = "newText" in row ? row.newText : undefined;
        const oldLine = "oldLine" in row ? row.oldLine : undefined;
        const newLine = "newLine" in row ? row.newLine : undefined;
        return (
          <div key={index} className="grid min-h-[22px] grid-cols-2">
            <div className={cn("review-split-cell flex min-w-0", oldChanged && oldText !== undefined && "diff-line-removed")}>
              <span className="review-gutter select-none">{oldLine ?? ""}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3"><CodeText text={oldText} query={query} /></span>
            </div>
            <div className={cn("review-split-cell flex min-w-0", newChanged && newText !== undefined && "diff-line-added")}>
              <span className="review-gutter select-none">{newLine ?? ""}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3"><CodeText text={newText} query={query} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiffGap({ hidden, onExpand, split }: { hidden: number; onExpand: () => void; split?: boolean }) {
  return (
    <div className="relative my-1 flex min-h-8 items-center justify-center text-[11px] text-zinc-500">
      <div className="absolute left-4 right-4 top-1/2 h-px bg-[#202126]" />
      <button onClick={onExpand} className="relative rounded-md border border-[#26282d] bg-[#15161a] px-2.5 py-1 text-zinc-400 shadow-sm transition-colors hover:border-zinc-500 hover:text-zinc-200">
        +{hidden} more lines
      </button>
      <div className={cn("absolute top-1/2 -translate-y-1/2 space-y-0.5", split ? "left-1/2" : "right-[36%]")}> 
        <button onClick={onExpand} className="block rounded border border-[#2a2c31] bg-[#15161a] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200">+10</button>
        <button onClick={onExpand} className="block rounded border border-[#2a2c31] bg-[#15161a] px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200">+10</button>
      </div>
    </div>
  );
}

function ReviewSidebar({ diffs, expandedFiles, onSelect }: { diffs: FileDiffEntry[]; expandedFiles: Set<string>; onSelect: (filePath: string) => void }) {
  return (
    <aside className="w-56 shrink-0 border-l border-[#1b1d20] bg-[#0b0b0c] px-3 py-3">
      <p className="mb-3 text-xs text-zinc-500">Files Changed</p>
      <div className="space-y-1">
        {diffs.map((entry) => (
          <button key={entry.filePath} onClick={() => onSelect(entry.filePath)} className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-white/[0.035]", expandedFiles.has(entry.filePath) && "bg-white/[0.03]")}> 
            <FileBadge path={entry.filePath} />
            <span className="min-w-0 truncate text-zinc-200">{baseName(entry.filePath)}</span>
            <span className="min-w-0 truncate text-xs text-zinc-500">{dirName(entry.filePath)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function FileBadge({ path }: { path: string }) {
  return <FileSymbolIcon path={path} className="w-5" />;
}

function CodeText({ text, query }: { text?: string; query: string }) {
  if (text === undefined) return <span className="text-transparent">.</span>;
  if (!text) return <> </>;
  const q = query.trim();
  if (!q) return <HiLine code={text} />;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "ig"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={index} className="rounded bg-amber-300/25 px-0.5 text-amber-100">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function buildLineOps(oldText: string, nextText: string): LineOp[] {
  const oldLines = splitDiffLines(oldText);
  const nextLines = splitDiffLines(nextText);
  if (oldLines.length * nextLines.length > 4_000_000) {
    return [
      ...oldLines.map((text, index) => ({ kind: "removed" as const, text, oldLine: index + 1 })),
      ...nextLines.map((text, index) => ({ kind: "added" as const, text, newLine: index + 1 })),
    ];
  }
  const dp = Array.from({ length: oldLines.length + 1 }, () => Array(nextLines.length + 1).fill(0) as number[]);

  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = nextLines.length - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === nextLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < nextLines.length) {
    if (oldLines[i] === nextLines[j]) {
      ops.push({ kind: "context", text: oldLines[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "removed", text: oldLines[i], oldLine: i + 1 });
      i++;
    } else {
      ops.push({ kind: "added", text: nextLines[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < oldLines.length) {
    ops.push({ kind: "removed", text: oldLines[i], oldLine: i + 1 });
    i++;
  }
  while (j < nextLines.length) {
    ops.push({ kind: "added", text: nextLines[j], newLine: j + 1 });
    j++;
  }
  return ops;
}

function buildSplitRows(ops: LineOp[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.kind === "context") {
      rows.push({ kind: "context", oldText: op.text, newText: op.text, oldLine: op.oldLine, newLine: op.newLine });
      index++;
      continue;
    }

    const removed: Extract<LineOp, { kind: "removed" }>[] = [];
    const added: Extract<LineOp, { kind: "added" }>[] = [];
    while (ops[index]?.kind === "removed") {
      removed.push(ops[index] as Extract<LineOp, { kind: "removed" }>);
      index++;
    }
    while (ops[index]?.kind === "added") {
      added.push(ops[index] as Extract<LineOp, { kind: "added" }>);
      index++;
    }

    if (removed.length > 0 && added.length > 0) {
      const count = Math.max(removed.length, added.length);
      for (let i = 0; i < count; i++) {
        rows.push({ kind: "changed", oldText: removed[i]?.text, newText: added[i]?.text, oldLine: removed[i]?.oldLine, newLine: added[i]?.newLine });
      }
    } else if (removed.length > 0) {
      rows.push(...removed.map((line) => ({ kind: "removed" as const, oldText: line.text, oldLine: line.oldLine })));
    } else {
      rows.push(...added.map((line) => ({ kind: "added" as const, newText: line.text, newLine: line.newLine })));
    }
  }
  return rows;
}

function collapseRows<T extends LineOp | SplitRow>(rows: T[], expanded: boolean): Array<T | GapRow> {
  if (expanded || rows.length <= 28) return rows;
  const head = 6;
  const tail = 8;
  return [...rows.slice(0, head), { kind: "gap", hidden: rows.length - head - tail }, ...rows.slice(-tail)];
}

function splitDiffLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r/g, "").split("\n");
}

function dirName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function countDiffMatches(diffs: FileDiffEntry[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let count = 0;
  for (const entry of diffs) {
    for (const hunk of entry.hunks) {
      const text = `${hunk.old}\n${hunk.next}`.toLowerCase();
      let index = text.indexOf(q);
      while (index !== -1) {
        count++;
        index = text.indexOf(q, index + q.length);
      }
    }
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function CodeTab({ chatId, token }: { chatId: string; token: number }) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [rootDir, setRootDir] = useState("");
  const [rootName, setRootName] = useState("Workspace");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<FileNode | null>(null);
  const [preview, setPreview] = useState<FilePreviewState | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTree = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/files/tree?chatId=${encodeURIComponent(chatId)}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as WorkspaceTreeResponse;
        const nextRoot = data.rootDir ?? "";
        setTree(data.tree ?? []);
        setRootDir(nextRoot);
        setRootName(data.rootName || workspaceFolderName(nextRoot));
      }
    } catch {
      setTree([]);
    }
  }, [chatId]);

  const loadChildren = useCallback(
    async (path: string): Promise<FileNode[]> => {
      try {
        const res = await fetch(`/api/workspace/files/tree?chatId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
        if (!res.ok) return [];
        const data = (await res.json()) as WorkspaceTreeResponse;
        const children = data.tree ?? [];
        setTree((current) => updateNodeChildren(current, path, children));
        return children;
      } catch {
        return [];
      }
    },
    [chatId],
  );

  const loadFilePreview = useCallback(
    async (path: string) => {
      const kind = previewKindForPath(path);
      setPreview({ kind });
      if (["document", "spreadsheet", "presentation", "archive", "binary"].includes(kind)) {
        setLoading(true);
        try {
          const res = await fetch(`/api/workspace/files/preview?chatId=${encodeURIComponent(chatId)}&filePath=${encodeURIComponent(path)}`, { cache: "no-store" });
          const data = (await res.json()) as { error?: string };
          setPreview(data.error ? { kind, error: data.error } : { kind, data: data as FilePreviewState["data"] });
        } catch {
          setPreview({ kind, error: "Failed to render file preview." });
        } finally {
          setLoading(false);
        }
        return;
      }

      if (kind !== "text" && kind !== "markdown") {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/workspace/files/read?chatId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(path)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { content?: string; error?: string };
        setPreview(data.error ? { kind, error: data.error } : { kind, content: data.content ?? "" });
      } catch {
        setPreview({ kind, error: "Failed to read file." });
      } finally {
        setLoading(false);
      }
    },
    [chatId],
  );

  useEffect(() => {
    void loadTree();
  }, [loadTree, token]);

  useEffect(() => {
    if (!selected || selectedDir) return;
    void loadFilePreview(selected);
  }, [loadFilePreview, selected, selectedDir, token]);

  const openPath = useCallback(
    async (rawPath: string, nodeType?: FileNode["type"]) => {
      const path = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
      if (!path) {
        setSelected(null);
        setSelectedDir(null);
        setPreview(null);
        setLoading(false);
        return;
      }
      const node = findNode(tree, path);
      const isDirectory = nodeType === "directory" || node?.type === "directory" || /\/$/.test(rawPath);
      setSelected(path);
      if (isDirectory) {
        const selectedNode = node ?? { name: baseName(path) || "Workspace", path, type: "directory" as const };
        setSelectedDir({ ...selectedNode, children: selectedNode.children ?? [] });
        setPreview(null);
        setLoading(false);
        if (!node?.children) {
          const children = await loadChildren(path);
          setSelectedDir({ ...selectedNode, children });
        }
        return;
      }

      setSelectedDir(null);
      await loadFilePreview(path);
    },
    [loadChildren, loadFilePreview, tree],
  );

  useEffect(() => {
    if (!selected || !selectedDir) return;
    const node = findNode(tree, selected);
    if (node?.type === "directory") setSelectedDir(node);
  }, [selected, selectedDir, tree]);

  // Allow message workspace links to open a file or folder here.
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (path) void openPath(path);
    };
    window.addEventListener("vaultgate:open-workspace-path", handler);
    window.addEventListener("vaultgate:open-file", handler);
    return () => {
      window.removeEventListener("vaultgate:open-workspace-path", handler);
      window.removeEventListener("vaultgate:open-file", handler);
    };
  }, [openPath]);

  const rootNode: FileNode = { name: rootName, path: "", type: "directory", children: tree };

  return (
    <div className="flex h-full bg-background">
      <div className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sm">
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Folder</p>
          <p className="mt-1 truncate text-sm font-medium text-foreground" title={rootDir || undefined}>{rootName}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={rootDir || undefined}>{rootDir || "Resolving workspace..."}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 scrollbar-none">
        {tree.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">No files in this folder yet.</p>
        ) : (
          <Tree nodes={tree} selected={selected} onOpen={openPath} onLoadChildren={loadChildren} depth={0} />
        )}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden bg-background">
        {loading ? (
          <p className="p-4 text-xs text-muted-foreground">Loading preview…</p>
        ) : selectedDir ? (
          <DirectoryPreview node={selectedDir} onOpen={openPath} />
        ) : selected && preview ? (
          <FilePreview chatId={chatId} filePath={selected} preview={preview} token={token} />
        ) : (
          <DirectoryPreview node={rootNode} onOpen={openPath} />
        )}
      </div>
    </div>
  );
}

function workspaceFolderName(rootDir: string): string {
  const normalized = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() || rootDir || "Workspace";
}

function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function updateNodeChildren(nodes: FileNode[], path: string, children: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.path === path) return { ...node, children };
    if (node.children) return { ...node, children: updateNodeChildren(node.children, path, children) };
    return node;
  });
}

function DirectoryPreview({ node, onOpen }: { node: FileNode; onOpen: (p: string, type?: FileNode["type"]) => void }) {
  const children = node.children ?? [];
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <FolderOpen className="size-4 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{node.name || node.path || "Workspace"}</p>
          <p className="text-[11px] text-muted-foreground">{children.length} item{children.length === 1 ? "" : "s"}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-none">
        {children.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            <p>This folder is empty or has not loaded yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
            {children.map((child) => (
              <button
                key={child.path}
                type="button"
                onClick={() => onOpen(child.path, child.type)}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                {child.type === "directory" ? <Folder className="size-4 shrink-0 text-primary" /> : <FileSymbolIcon path={child.path} />}
                <span className="truncate text-sm text-foreground/90">{child.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tree({ nodes, selected, onOpen, onLoadChildren, depth }: { nodes: FileNode[]; selected: string | null; onOpen: (p: string, type?: FileNode["type"]) => void; onLoadChildren: (p: string) => Promise<FileNode[]>; depth: number }) {
  return (
    <div>
      {nodes.map((node) =>
        node.type === "directory" ? (
          <DirNode key={node.path} node={node} selected={selected} onOpen={onOpen} onLoadChildren={onLoadChildren} depth={depth} />
        ) : (
          <button
            key={node.path}
            onClick={() => onOpen(node.path, "file")}
            style={{ paddingLeft: depth * 12 + 8 }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
              selected === node.path ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <FileSymbolIcon path={node.path} size={14} />
            <span className="truncate">{node.name}</span>
          </button>
        ),
      )}
    </div>
  );
}

function DirNode({ node, selected, onOpen, onLoadChildren, depth }: { node: FileNode; selected: string | null; onOpen: (p: string, type?: FileNode["type"]) => void; onLoadChildren: (p: string) => Promise<FileNode[]>; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          onOpen(node.path, "directory");
          if (next && !node.children) void onLoadChildren(node.path);
        }}
        style={{ paddingLeft: depth * 12 + 8 }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/60 hover:text-foreground",
          selected === node.path ? "bg-muted text-foreground" : "text-foreground/80",
        )}
      >
        {open ? <FolderOpen className="size-3.5 shrink-0 text-primary" /> : <Folder className="size-3.5 shrink-0 text-primary" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children && <Tree nodes={node.children} selected={selected} onOpen={onOpen} onLoadChildren={onLoadChildren} depth={depth + 1} />}
    </div>
  );
}

export function WorkspaceHandle({ chatId }: { chatId: string }) {
  const hasNotification = useWorkspaceStore((s) => s.hasNotification);
  const clearNotification = useWorkspaceStore((s) => s.clearNotification);
  const activate = useWorkspaceStore((s) => s.activate);

  return (
    <div className="animate-fade-in fixed right-0 top-1/2 z-40 hidden -translate-y-1/2 lg:flex">
      {hasNotification && (
        <div className="absolute inset-0 -inset-x-0.5 -inset-y-1 rounded-l-xl">
          <div
            className="absolute inset-0 rounded-l-xl opacity-60"
            style={{
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #06b6d4, #3b82f6)",
              backgroundSize: "300% 300%",
              animation: "vg-glow-shift 3s ease infinite",
              filter: "blur(6px)",
            }}
          />
          <div
            className="absolute inset-0 rounded-l-xl opacity-30"
            style={{
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #06b6d4, #3b82f6)",
              backgroundSize: "300% 300%",
              animation: "vg-glow-shift 3s ease infinite",
              filter: "blur(14px)",
            }}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          clearNotification();
          activate(chatId, "code");
        }}
        className={cn(
          "relative items-center gap-1 rounded-l-xl border border-r-0 px-2 py-3 shadow-xl shadow-black/20 backdrop-blur transition-all duration-300 hover:bg-muted hover:text-foreground flex",
          hasNotification
            ? "border-blue-500/40 bg-card text-foreground"
            : "border-border bg-card/95 text-muted-foreground",
        )}
        title="Open workspace"
      >
        <ChevronLeft className="size-4" />
        {hasNotification && (
          <span className="absolute -left-0.5 -top-0.5 flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-blue-500" />
          </span>
        )}
      </button>
      <style>{`
        @keyframes vg-glow-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>
    </div>
  );
}
