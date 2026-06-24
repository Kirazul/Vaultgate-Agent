"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";
import { useElapsed, formatElapsed } from "@/hooks/use-elapsed";

/**
 * Antigravity-style "Thought for Xs" collapsible reasoning row. Sits inside the
 * message-level "Worked for Xs" work area; auto-opens while the model is
 * actively thinking, then collapses to a one-line summary once done.
 */
export function Reasoning({
  content,
  streaming,
  startedAt,
  durationMs,
}: {
  content: string;
  streaming: boolean;
  startedAt?: number;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const userToggled = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(streaming, startedAt, durationMs);

  useEffect(() => {
    if (streaming && !userToggled.current) setOpen(true);
  }, [streaming]);

  // Keep the thinking panel pinned to its newest line while streaming.
  useEffect(() => {
    if (streaming && open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [content, streaming, open]);

  if (!content) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          userToggled.current = true;
          setOpen((value) => !value);
        }}
        className="group flex min-h-8 w-full select-none items-center gap-1 rounded-lg px-2 py-1 text-left text-sm tabular-nums text-foreground transition-colors hover:bg-muted"
      >
        <span className={cn("text-secondary-foreground", streaming && "animate-pulse")}>
          {streaming ? "Thinking" : "Thought"} for {formatElapsed(elapsed)}
        </span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-all duration-200 group-hover:text-secondary-foreground",
            open && "rotate-90 text-secondary-foreground",
          )}
        />
      </button>
      {open && (
        <div ref={bodyRef} className="max-h-72 animate-fade-in overflow-y-auto scrollbar-none px-2 pl-3 py-1">
          <Markdown
            content={content}
            className="text-sm leading-relaxed text-muted-foreground [&_code]:bg-code-background [&_code]:text-code-foreground [&_h1]:text-sm [&_h2]:border-0 [&_h2]:pt-0 [&_h2]:text-sm [&_h3]:text-sm [&_p]:mb-2"
          />
        </div>
      )}
    </div>
  );
}
