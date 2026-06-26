"use client";
import { memo, useEffect, useState } from "react";
import { Check, ChevronRight, Copy, Loader2, RotateCcw, Terminal, MessageCircleQuestion, AlertCircle } from "lucide-react";
import type { ContentBlock, Message } from "@/types";
import { Markdown } from "@/components/markdown/Markdown";
import { Reasoning } from "@/components/markdown/Reasoning";
import { ToolCalls, getMessageFileDiffs, FileChangeSummary } from "./ToolCalls";
import { cn } from "@/lib/utils";
import { useElapsed, formatElapsed } from "@/hooks/use-elapsed";
import { useChatStore } from "@/lib/store/chat-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { MODES } from "@/lib/modes";

/** "21:32, 20/05/2026" — Antigravity message timestamp format. */
function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function MessageBubbleImpl({ message, onRegenerate }: { message: Message; onRegenerate?: (message: Message) => void }) {
  const [copied, setCopied] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [workOpen, setWorkOpen] = useState(true);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const streaming = message.status === "streaming";
  const stopped = message.status === "cancelled";
  const failed = message.status === "error";
  const canRegenerate = message.role === "assistant" && Boolean(onRegenerate);
  const hasWork = message.blocks.some((block) => block.type === "reasoning" || block.type === "tool_calls");
  const lastTextIndex = message.blocks.findLastIndex((block) => block.type === "text");
  const workspaceChatId = useChatStore((s) => s.chats.find((chat) => chat.id === message.chatId)?.parentId ?? message.chatId);
  const isChatStreaming = useChatStore((s) => Boolean(s.streamingByChat[message.chatId]));
  const rollbackToMessage = useChatStore((s) => s.rollbackToMessage);
  const setDraft = useChatStore((s) => s.setDraft);

  useEffect(() => {
    if (streaming) setWorkOpen(true);
  }, [streaming]);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const rollback = async () => {
    if (rollingBack || isChatStreaming) return;
    setRollingBack(true);
    try {
      await rollbackToMessage(message.chatId, message.id, message.createdAt);
      setDraft(message.chatId, message.content);
    } catch (err) {
      console.error(err);
    } finally {
      setRollingBack(false);
    }
  };

  if (isUser) {
    return (
      <div
        role="article"
        aria-label="User message"
        className="waterfall group/user sticky top-0 z-10 mb-3 bg-[var(--ui-bg-chrome)] pt-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-7 after:bg-gradient-to-b after:from-[var(--ui-bg-chrome)] after:to-transparent after:content-['']"
      >
        <div className="relative rounded-xl bg-[var(--ui-stroke-tertiary)] p-px">
          <div className="relative flex flex-col gap-0 overflow-hidden rounded-[11px] bg-[var(--ui-bg-editor)] px-3 py-2">
            <div className="whitespace-pre-wrap break-words text-sm">
              <Markdown content={message.content} chatId={workspaceChatId} className="text-[length:var(--conversation-text-font-size)] leading-relaxed [&_p]:mb-1.5 [&_ul]:my-1.5" />
            </div>
            <div className="absolute bottom-1 right-1 flex items-center gap-1 rounded-full bg-card p-1 opacity-0 shadow-sm transition-all group-hover/user:opacity-100">
              <span className="mr-1 self-center text-xs text-muted-foreground">{formatTimestamp(message.createdAt)}</span>
              <button onClick={copy} className="p-0.5 text-muted-foreground transition-colors hover:text-secondary-foreground" title="Copy">
                {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
              </button>
              <button
                onClick={rollback}
                disabled={rollingBack || isChatStreaming}
                className="p-0.5 text-muted-foreground transition-colors hover:text-secondary-foreground disabled:pointer-events-none disabled:opacity-40"
                title="Undo changes up to this point"
              >
                {rollingBack ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── System messages (slash commands, /btw, errors) ──
  if (isSystem) {
    return <SystemMessageCard message={message} streaming={streaming} workspaceChatId={workspaceChatId} />;
  }

  // Compute file diffs for the summary bar
  const fileDiffs = !streaming ? getMessageFileDiffs(message.blocks) : [];

  return (
    <div role="article" aria-label="Agent response" className="waterfall group mb-3 flex flex-col gap-[var(--turn-block-gap)]">
      {message.blocks.length > 0 ? (
        <OrderedBlocks message={message} hasWork={hasWork} workOpen={workOpen} setWorkOpen={setWorkOpen} streaming={streaming} stopped={stopped} lastTextIndex={lastTextIndex} workspaceChatId={workspaceChatId} />
      ) : streaming ? (
        <div className="px-[var(--message-indent)]">
          <ThinkingDots />
        </div>
      ) : stopped ? (
        <StoppedNotice />
      ) : null}

      {!streaming && fileDiffs.length > 0 && <FileChangeSummary diffs={fileDiffs} chatId={workspaceChatId} />}

      {!streaming && (stopped || failed) && canRegenerate && (
        <div className="px-[var(--message-indent)]">
          <button
            type="button"
            onClick={() => onRegenerate?.(message)}
            disabled={isChatStreaming}
            className="rounded-md border border-[var(--ui-stroke-tertiary)] px-2.5 py-1.5 text-xs font-medium text-[var(--ui-text-secondary)] transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            title="Rewind to the prompt that produced this response and run it again"
          >
            Retry from here
          </button>
        </div>
      )}

      {!streaming && (message.content || stopped) && (
        <div className="flex items-center gap-1 px-[var(--message-indent)] opacity-0 transition-opacity group-hover:opacity-100">
          <span className="mr-auto flex h-5 items-center whitespace-nowrap text-[0.7rem] text-[var(--ui-text-quaternary)]">{stopped ? `Stopped · ${formatTimestamp(message.createdAt)}` : formatTimestamp(message.createdAt)}</span>
          {canRegenerate && (
            <button
              onClick={() => onRegenerate?.(message)}
              disabled={isChatStreaming}
              className="flex items-center justify-center rounded-md p-0.5 text-[var(--ui-text-tertiary)] transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              title="Regenerate from the previous user message"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
          {message.content && (
            <button onClick={copy} className="flex items-center justify-center rounded-md p-0.5 text-[var(--ui-text-tertiary)] transition-colors hover:text-foreground" title="Copy">
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OrderedBlocks({
  message,
  hasWork,
  workOpen,
  setWorkOpen,
  streaming,
  stopped,
  lastTextIndex,
  workspaceChatId,
}: {
  message: Message;
  hasWork: boolean;
  workOpen: boolean;
  setWorkOpen: (open: boolean) => void;
  streaming: boolean;
  stopped: boolean;
  lastTextIndex: number;
  workspaceChatId: string;
}) {
  let workSummaryShown = false;

  return (
    <>
      {message.blocks.map((block, i) => {
        if (block.type === "text") {
          return (
            <div key={`text-${i}`} className="px-[var(--message-indent)] text-[length:var(--conversation-text-font-size)] leading-relaxed text-foreground">
              <Markdown content={block.content} chatId={workspaceChatId} />
              {streaming && i === lastTextIndex && <span className="streaming-cursor" />}
            </div>
          );
        }

        const showSummary = hasWork && !workSummaryShown;
        workSummaryShown = true;
        return (
          <div key={`${block.type}-${i}`} className="flex flex-col gap-[var(--tool-row-gap)] px-[var(--message-indent)]">
            {showSummary && <WorkSummary open={workOpen} setOpen={setWorkOpen} streaming={streaming} stopped={stopped} durationMs={message.durationMs} createdAt={message.createdAt} />}
            {workOpen && (
              <WorkBlock block={block} streaming={streaming} isLast={i === message.blocks.length - 1} chatId={workspaceChatId} />
            )}
          </div>
        );
      })}
    </>
  );
}

function WorkSummary({ open, setOpen, streaming, stopped, durationMs, createdAt }: { open: boolean; setOpen: (open: boolean) => void; streaming: boolean; stopped: boolean; durationMs?: number; createdAt: number }) {
  const elapsed = useElapsed(streaming, createdAt, durationMs);
  const label = streaming ? `Working for ${formatElapsed(elapsed)}` : stopped ? `Stopped after ${formatElapsed(elapsed)}` : `Worked for ${formatElapsed(elapsed)}`;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="The thinking and tool calls VaultGate used. Click to show or hide the details."
        className="group/row flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[length:var(--conversation-tool-font-size)] tabular-nums transition-colors hover:text-foreground"
      >
        <span className={cn("font-medium text-[var(--ui-text-secondary)]", streaming && "shimmer")}>
          {label}
        </span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-[var(--ui-text-quaternary)] transition-all duration-150",
            open ? "rotate-90 text-[var(--ui-text-tertiary)] opacity-80" : "opacity-0 group-hover/row:opacity-80",
          )}
        />
      </button>
    </div>
  );
}

function WorkBlock({ block, streaming, isLast, chatId }: { block: ContentBlock; streaming: boolean; isLast: boolean; chatId: string }) {
  // A reasoning block is only "live" while it is the trailing block of a
  // streaming message; once text or a tool call follows, thinking is done.
  if (block.type === "reasoning") return <Reasoning content={block.content} streaming={streaming && isLast} startedAt={block.startedAt} durationMs={block.durationMs} />;
  if (block.type === "tool_calls") return <ToolCalls block={block} streaming={streaming && isLast} isLast={isLast} chatId={chatId} />;
  return null;
}

function StoppedNotice() {
  return <div className="px-2 py-1.5 text-sm text-muted-foreground">Stopped before any visible response.</div>;
}

function ThinkingDots() {
  return (
    <div className={cn("flex h-5 items-center gap-1 text-muted-foreground")} aria-label="Thinking">
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </div>
  );
}

function SystemMessageCard({ message, streaming, workspaceChatId }: { message: Message; streaming: boolean; workspaceChatId: string }) {
  const [dismissed, setDismissed] = useState(false);
  const mode = useSettingsStore((s) => s.mode);
  const modeDef = MODES[mode] ?? MODES.agent;
  const accent = modeDef.accent;

  const isBtw = message.content.startsWith("/btw ");
  const isError = message.status === "error";
  const isBtwStreaming = isBtw && streaming;

  const btwLabel = isBtw ? message.content.split("\n")[0].replace(/^\/btw\s*/, "").trim() : "";
  const btwBody = isBtw ? message.content.split("\n").slice(1).join("\n").trim() : "";
  const commandBody = !isBtw ? message.content : "";
  const slashMatch = !isBtw ? message.content.match(/^\/(\w+)/) : null;
  const slashName = slashMatch ? `/${slashMatch[1]}` : null;

  if (dismissed) return null;

  const accentStyle = isError ? undefined : { "--sys-accent": accent } as React.CSSProperties;

  return (
    <div className="waterfall mb-3">
      <div
        className={cn(
          "group/sys relative overflow-hidden rounded-xl border px-4 py-3 transition-colors",
          isError
            ? "border-red-500/25 bg-red-500/[0.04]"
            : "bg-[color-mix(in_srgb,var(--sys-accent)_4%,transparent)] border-[color-mix(in_srgb,var(--sys-accent)_20%,transparent)]",
        )}
        style={accentStyle}
      >
        {/* Header */}
        <div className="mb-2 flex items-center gap-2">
          {isBtw ? (
            <MessageCircleQuestion className="size-3.5" style={isError ? undefined : { color: accent }} />
          ) : isError ? (
            <AlertCircle className="size-3.5 text-red-400" />
          ) : (
            <Terminal className="size-3.5" style={{ color: accent }} />
          )}
          <span
            className={cn("text-xs font-semibold", isError && "text-red-400")}
            style={isError ? undefined : { color: accent }}
          >
            {isBtw ? `/btw ${btwLabel}` : isError ? "Error" : slashName ?? "System"}
          </span>
          {isBtwStreaming && <Loader2 className="size-3 animate-spin" style={{ color: accent }} />}

          <span className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{formatTimestamp(message.createdAt)}</span>
            {!streaming && (
              <button
                onClick={() => setDismissed(true)}
                className="rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/sys:opacity-100"
                title="Dismiss"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            )}
          </span>
        </div>

        {/* Body */}
        <div className={cn("text-sm leading-relaxed", isBtw ? "text-foreground/90" : "text-muted-foreground")}>
          {isBtw ? (
            btwBody ? (
              <Markdown content={btwBody} chatId={workspaceChatId} className="text-sm [&_p]:mb-1.5" />
            ) : (
              <span className="animate-pulse text-xs text-muted-foreground">Thinking...</span>
            )
          ) : (
            <Markdown content={commandBody} chatId={workspaceChatId} className="text-sm [&_p]:mb-1" />
          )}
        </div>

        {/* Left accent stripe */}
        <div
          className="absolute left-0 top-0 h-full w-[3px]"
          style={isError ? { backgroundColor: "rgb(239 68 68 / 0.5)" } : { backgroundColor: accent, opacity: 0.5 }}
        />
      </div>
    </div>
  );
}

// Memoized: completed bubbles keep the same `message` ref across
// stream flushes, so only the active streaming bubble re-renders.
export const MessageBubble = memo(MessageBubbleImpl);
