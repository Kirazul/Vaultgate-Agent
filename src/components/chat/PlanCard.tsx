"use client";
import { useState } from "react";
import { Check, ClipboardCheck, CornerDownLeft, Pencil, X } from "lucide-react";
import type { PendingPlan } from "@/types";
import { Markdown } from "@/components/markdown/Markdown";
import { cn } from "@/lib/utils";

type Phase = "review" | "approving" | "requesting" | "leaving";

/**
 * Implementation-plan approval card (Code mode, plan-first). The plan markdown
 * is showcased for the user. Approve plays a brief accent-glow + "building…"
 * hand-off animation, then smoothly lifts away into execution. Request changes
 * opens an inline field — the agent revises and re-presents the plan, looping
 * until approval.
 */
export function PlanCard({
  plan,
  workspaceChatId,
  onApprove,
  onRequestChanges,
}: {
  plan: PendingPlan;
  workspaceChatId: string;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [phase, setPhase] = useState<Phase>("review");

  const submitChanges = () => {
    const text = feedback.trim();
    if (!text || phase !== "review") return;
    setPhase("requesting");
    setTimeout(() => onRequestChanges(text), 120);
    setTimeout(() => setPhase("leaving"), 360);
  };

  const approve = () => {
    if (phase !== "review") return;
    setEditing(false);
    setPhase("approving");
    // Glow + building sweep, then lift/fade out and hand off to execution.
    setTimeout(() => setPhase("leaving"), 540);
    setTimeout(() => onApprove(), 840);
  };

  const busy = phase !== "review";
  const busyMessage = phase === "requesting" ? "Sending requested changes…" : "Approved — building your plan…";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-card shadow-sm transition-[transform,opacity] duration-300 ease-out",
          phase === "review" && "border-ring/40",
          phase === "approving" && "plan-approving border-primary/60",
          phase === "leaving" && "plan-approving border-primary/60 -translate-y-1 scale-[0.985] opacity-0",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5">
          <ClipboardCheck className="size-4 shrink-0 text-ring" />
          <span className="text-sm font-semibold text-foreground">Implementation plan</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">· {plan.title}</span>
          {plan.file && (
            <a href={`workspace-file:${encodeURIComponent(plan.file)}`} className="shrink-0 text-[11px] text-muted-foreground/80 underline-offset-2 hover:underline">
              {plan.file.split("/").pop()}
            </a>
          )}
        </div>
        <div className={cn("max-h-[46vh] overflow-y-auto px-4 py-3 text-sm transition-opacity duration-300", busy && "opacity-60")}>
          <Markdown content={plan.plan} chatId={workspaceChatId} />
        </div>

        {busy ? (
          <div className="flex animate-fade-in items-center gap-3 border-t border-primary/30 px-4 py-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
              {phase === "requesting" ? <Pencil className="size-3.5 text-primary" /> : <Check className="size-3.5 text-primary" />}
            </span>
            <span className="text-sm font-medium text-foreground">{busyMessage}</span>
            <div className="ml-auto h-1 w-28 overflow-hidden rounded-full bg-primary/15">
              <span className="plan-build-sweep block h-full w-1/3 rounded-full bg-primary" />
            </div>
          </div>
        ) : editing ? (
          <div className="flex flex-col gap-2 border-t border-border/60 p-3">
            <textarea
              autoFocus
              disabled={busy}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitChanges();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              rows={3}
              placeholder="What should change about this plan? (e.g. use Postgres instead of SQLite, add tests, split step 3…)"
              className="w-full resize-y rounded-lg border border-border bg-background p-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring/50"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-muted"
              >
                <X className="size-3.5" /> Cancel
              </button>
              <button
                onClick={submitChanges}
                disabled={!feedback.trim() || busy}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                Send changes <CornerDownLeft className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5">
            <span className="hidden text-[11px] text-muted-foreground/70 sm:block">Review the plan, then approve to build it — or request changes.</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-muted"
                title="Tell VaultGate what to change; it will revise the plan and show it again"
              >
                <Pencil className="size-3.5" /> Request changes
              </button>
              <button
                onClick={approve}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                title="Approve the plan and let VaultGate implement it"
              >
                <Check className="size-4" /> Approve &amp; build
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
