"use client";
import { useState } from "react";
import { Check, CornerDownLeft, HelpCircle } from "lucide-react";
import type { PendingQuestion } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Interactive clarifying question shown when the agent calls AskUserQuestion.
 * Picking an option sends it as the user's next message, resuming the agent.
 */
export function QuestionCard({ question, onAnswer }: { question: PendingQuestion; onAnswer: (label: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);

  const answer = (label: string) => {
    if (selected) return;
    setSelected(label);
    onAnswer(label);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div className="rounded-2xl border border-ring/40 bg-card shadow-sm">
        <div className="flex items-start gap-2 border-b border-border/60 px-4 py-3">
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-ring" />
          <div className="min-w-0">
            {question.header && (
              <span className="mb-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{question.header}</span>
            )}
            <p className="text-sm font-medium text-foreground">{question.question}</p>
          </div>
        </div>
        <div className="grid gap-1.5 p-2 sm:grid-cols-2">
          {question.options.map((opt, i) => (
            <button
              key={`${opt.label}-${i}`}
              onClick={() => answer(opt.label)}
              disabled={Boolean(selected)}
              className={cn(
                "group flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:pointer-events-none",
                selected === opt.label ? "border-ring/70 bg-muted/70" : "border-border hover:border-ring/50 hover:bg-muted/60",
                selected && selected !== opt.label && "opacity-45",
              )}
            >
              <span className="flex w-full items-center gap-1.5 text-sm font-medium text-foreground">
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {selected === opt.label ? <Check className="size-3.5 shrink-0 text-ring" /> : <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
              </span>
              {opt.description && <span className="text-xs text-muted-foreground">{opt.description}</span>}
            </button>
          ))}
        </div>
        <p className="px-4 pb-2.5 text-[11px] text-muted-foreground/70">{selected ? `Sending "${selected}"...` : "Pick an option, or just type your own answer below."}</p>
      </div>
    </div>
  );
}
