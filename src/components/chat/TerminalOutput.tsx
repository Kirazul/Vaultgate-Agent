"use client";

import { cn } from "@/lib/utils";

function terminalClass(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "text-[var(--ui-text-quaternary)]";
  if (/\b(error|failed|failure|exception|traceback|fatal|cannot find|not recognized|exit code: [1-9])\b/i.test(trimmed)) return "text-rose-500 dark:text-rose-400";
  if (/\b(warn|warning|deprecated)\b/i.test(trimmed)) return "text-amber-600 dark:text-amber-400";
  if (/\b(success|succeed|done|ready|compiled|built|started|listening|passed|ok)\b/i.test(trimmed)) return "text-emerald-600 dark:text-emerald-400";
  if (/^(…\/[^\s>]*\s*>|>|\$|PS\b)/.test(trimmed)) return "text-primary";
  if (/^\s*(npm|pnpm|yarn|bun|node|npx|python|pip|git|next|tsc|eslint|cargo|go|deno)\b/i.test(trimmed)) return "text-sky-600 dark:text-sky-400";
  if (/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/.test(trimmed)) return "text-violet-600 dark:text-violet-400";
  if (/^\s*[+]/.test(trimmed)) return "text-emerald-600 dark:text-emerald-400";
  if (/^\s*[-]/.test(trimmed) && !/^\s*--?\w/.test(trimmed)) return "text-rose-600 dark:text-rose-400";
  return "text-[var(--ui-text-secondary)]";
}

export function TerminalOutput({
  chunks,
  compact = false,
  showLineNumbers = false,
  emptyLabel = "No terminal output yet.",
}: {
  chunks: string[];
  compact?: boolean;
  showLineNumbers?: boolean;
  emptyLabel?: string;
}) {
  const text = chunks.join("");
  const lines = text.length ? text.replace(/\r/g, "").split("\n") : [];

  if (lines.length === 0 || !text.trim()) return <p className="px-3 py-2 text-[length:var(--conversation-tool-font-size)] text-[var(--ui-text-tertiary)]">{emptyLabel}</p>;

  return (
    <div className={cn("min-w-0 max-w-full font-mono leading-[1.55] selection:bg-primary/25", compact ? "text-[0.72rem]" : "text-[12.5px]")}>
      {lines.map((line, index) => (
        <div key={index} className={cn("group flex min-h-[1.35rem] min-w-0 px-3", !compact && "hover:bg-[var(--ui-row-hover-background)]")}>
          {showLineNumbers && !compact && (
            <span className="mr-4 w-10 shrink-0 select-none text-right text-[var(--ui-text-quaternary)] group-hover:text-[var(--ui-text-tertiary)]">{index + 1}</span>
          )}
          <pre className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", terminalClass(line))}>{line || " "}</pre>
        </div>
      ))}
    </div>
  );
}
