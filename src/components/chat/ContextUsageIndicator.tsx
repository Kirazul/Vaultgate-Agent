"use client";

import { useMemo, useState } from "react";
import { useChatStore, EMPTY_MESSAGES } from "@/lib/store/chat-store";
import { useUsageStore } from "@/lib/store/usage-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { cn } from "@/lib/utils";

function ProgressCircle({ percentage, size = 16, strokeWidth = 3 }: { percentage: number; size?: number; strokeWidth?: number }) {
  const viewBox = 16;
  const center = viewBox / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${viewBox} ${viewBox}`} fill="none" className="-rotate-90">
      <circle cx={center} cy={center} r={radius} className="stroke-border/40" strokeWidth={strokeWidth} />
      <circle
        cx={center} cy={center} r={radius}
        className={cn(
          "transition-[stroke-dashoffset] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]",
          clamped > 90 ? "stroke-red-400" : clamped > 70 ? "stroke-amber-400" : "stroke-primary",
        )}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ContextUsageIndicator() {
  const chatId = useChatStore((s) => s.currentChatId);
  const messages = useChatStore((s) => (chatId ? s.messagesByChat[chatId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const chatUsage = useUsageStore((s) => (chatId ? s.byChat[chatId] : undefined));
  const contextTokens = useUsageStore((s) => (chatId ? s.contextByChat[chatId] ?? 0 : 0));
  const model = useSettingsStore((s) => s.provider.model);
  const providers = useSettingsStore((s) => s.providers);
  const roles = useSettingsStore((s) => s.roles);
  const [showPopover, setShowPopover] = useState(false);

  const modelInfo = useMemo(() => {
    const chatRole = roles.chat;
    const provider = providers.find((p) => p.id === chatRole?.providerId) ?? providers[0];
    return provider?.modelInfo?.[model];
  }, [providers, roles, model]);

  const contextLimit = modelInfo?.limit.context ?? 0;
  // "% full" is the latest request's footprint against the model's window — the
  // same way Claude Code / opencode report it. It does NOT grow with cost.
  const percentage = contextLimit > 0 ? Math.min(100, Math.round((contextTokens / contextLimit) * 100)) : 0;
  const remaining = contextLimit > 0 ? Math.max(0, contextLimit - contextTokens) : 0;

  if (!chatId || messages.length === 0) return null;

  const messageCount = messages.filter((m) => m.role === "user" || m.role === "assistant").length;

  return (
    <div className="relative">
      <button
        onClick={() => setShowPopover((v) => !v)}
        className="app-no-drag flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        title={`Memory used in this chat: ${fmtTokens(contextTokens)}${contextLimit ? ` of ${fmtTokens(contextLimit)}` : ""} (${percentage}% full)`}
      >
        <ProgressCircle percentage={percentage} size={14} strokeWidth={2.5} />
        <span>{percentage}%</span>
      </button>

      {showPopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPopover(false)} />
          <div className="animate-in fade-in slide-in-from-top-1 absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-card-border bg-popover p-3.5 text-popover-foreground shadow-xl duration-200">
            <h4 className="text-xs font-semibold text-foreground">Chat memory</h4>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              How much of {model || "the model"}&apos;s working memory this conversation is using right now.
            </p>

            <div className="mt-3 flex items-center gap-3">
              <ProgressCircle percentage={percentage} size={40} strokeWidth={4} />
              <div className="min-w-0">
                <p className="text-lg font-bold tabular-nums text-foreground">{percentage}% full</p>
                <p className="text-[10px] text-muted-foreground">
                  {contextLimit > 0 ? `${fmtTokens(contextTokens)} of ${fmtTokens(contextLimit)} tokens` : `${fmtTokens(contextTokens)} tokens`}
                </p>
              </div>
            </div>

            {/* Plain bar so the fill is obvious at a glance. */}
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]",
                  percentage > 90 ? "bg-red-400" : percentage > 70 ? "bg-amber-400" : "bg-primary",
                )}
                style={{ width: `${Math.max(2, percentage)}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
              {contextLimit > 0 && <MetricRow label="Room left" value={`${fmtTokens(remaining)} tokens`} />}
              <MetricRow label="Messages" value={`${messageCount}`} />
              {chatUsage && chatUsage.cost > 0 && <MetricRow label="Spent so far" value={`$${chatUsage.cost.toFixed(chatUsage.cost < 0.01 ? 4 : 2)}`} highlight />}
              {chatUsage && chatUsage.totalTokens > 0 && <MetricRow label="Total used" value={fmtTokens(chatUsage.totalTokens)} />}
            </div>

            {percentage > 80 ? (
              <p className="mt-3 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-500">
                Memory is {percentage}% full. Older messages are summarized automatically to make room — nothing is lost, the chat just keeps flowing.
              </p>
            ) : (
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground/80">
                When this fills up, older messages are summarized automatically so the chat never gets stuck.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums text-right", highlight ? "font-medium text-emerald-400" : "text-foreground")}>{value}</span>
    </>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
