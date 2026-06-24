"use client";

import { cn } from "@/lib/utils";

function terminalClass(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "text-muted-foreground/60";
  if (/\b(error|failed|exception|traceback|cannot find|not recognized|exit code: [1-9])\b/i.test(trimmed)) return "text-destructive";
  if (/\b(warn|warning|deprecated)\b/i.test(trimmed)) return "text-amber-500";
  if (/\b(success|done|ready|compiled|started|listening|ok)\b/i.test(trimmed)) return "text-emerald-500";
  if (/^(…\/workspace\s*>|>|\$|PS\b|npm\s|node\s|npx\s|python\s|pip\s|vaultgate\b|bun\b)/i.test(trimmed)) return "text-primary";
  if (/^\s*(GET|POST|PUT|PATCH|DELETE)\s+/i.test(trimmed)) return "text-violet-500";
  return "text-foreground/90";
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

  if (lines.length === 0 || !text.trim()) return <p className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</p>;

  return (
    <div className={cn("min-w-0 max-w-full font-mono leading-relaxed", compact ? "text-xs" : "text-[12.5px]")}>
      {lines.map((line, index) => (
        <div key={index} className={cn("group flex min-h-[1.4rem] min-w-0", compact ? "px-3" : "px-3 hover:bg-muted/40")}>
          {showLineNumbers && !compact && <span className="mr-4 w-10 shrink-0 select-none text-right text-muted-foreground/45 group-hover:text-muted-foreground">{index + 1}</span>}
          <pre className={cn("min-w-0 whitespace-pre-wrap break-words", terminalClass(line))}>{line || " "}</pre>
        </div>
      ))}
    </div>
  );
}
