"use client";
import { useMemo } from "react";
import { BarChart3, Clock, Coins, Cpu, FileCode, Hash, MessageSquare, Terminal, Wrench, Zap } from "lucide-react";
import { useChatStore, EMPTY_MESSAGES } from "@/lib/store/chat-store";
import { useUsageStore } from "@/lib/store/usage-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { normalizeToolName } from "@/lib/ai/tool-display";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/hooks/use-elapsed";

// ── Dependency-free SVG donut ────────────────────────────────
interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

function Donut({ slices, size = 132, thickness = 16, centerLabel, centerSub }: { slices: DonutSlice[]; size?: number; thickness?: number; centerLabel: string; centerSub?: string }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-border/30" strokeWidth={thickness} />
        {slices.map((s) => {
          const fraction = s.value / total;
          const dash = fraction * circumference;
          const seg = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              className="transition-[stroke-dasharray,stroke-dashoffset] duration-700 ease-out"
            />
          );
          offset += dash;
          return seg;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-bold tabular-nums text-foreground">{centerLabel}</span>
        {centerSub && <span className="text-[10px] text-muted-foreground">{centerSub}</span>}
      </div>
    </div>
  );
}

interface SessionStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  systemMessages: number;
  totalToolCalls: number;
  toolBreakdown: Record<string, number>;
  filesEdited: Set<string>;
  filesCreated: Set<string>;
  commandsRun: number;
  totalDurationMs: number;
  reasoningBlocks: number;
  subAgents: number;
  errors: number;
}

function computeStats(chatId: string | null): SessionStats {
  const messages = chatId ? useChatStore.getState().messagesByChat[chatId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES;
  const stats: SessionStats = {
    totalMessages: messages.length,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    totalToolCalls: 0,
    toolBreakdown: {},
    filesEdited: new Set(),
    filesCreated: new Set(),
    commandsRun: 0,
    totalDurationMs: 0,
    reasoningBlocks: 0,
    subAgents: 0,
    errors: 0,
  };

  for (const msg of messages) {
    if (msg.role === "user") stats.userMessages++;
    else if (msg.role === "assistant") {
      stats.assistantMessages++;
      if (msg.durationMs) stats.totalDurationMs += msg.durationMs;
    }
    else if (msg.role === "system") stats.systemMessages++;
    if (msg.status === "error") stats.errors++;

    for (const block of msg.blocks) {
      if (block.type === "reasoning") stats.reasoningBlocks++;
      if (block.type === "tool_calls") {
        for (const call of block.toolCalls ?? []) {
          stats.totalToolCalls++;
          const n = normalizeToolName(call.name);
          stats.toolBreakdown[n] = (stats.toolBreakdown[n] || 0) + 1;

          if (n === "bash") stats.commandsRun++;
          if (n === "task") stats.subAgents++;

          if (["write"].includes(n)) {
            try {
              const a = JSON.parse(call.arguments || "{}");
              if (a.filepath || a.file_path || a.path) stats.filesCreated.add(String(a.filepath || a.file_path || a.path));
            } catch { /* ignore */ }
          }
          if (["edit", "multiedit"].includes(n)) {
            try {
              const a = JSON.parse(call.arguments || "{}");
              if (a.filepath || a.file_path || a.path) stats.filesEdited.add(String(a.filepath || a.file_path || a.path));
            } catch { /* ignore */ }
          }

          const result = block.results?.find((r) => r.toolCallId === call.id);
          if (result?.status === "error") stats.errors++;
        }
      }
    }
  }

  return stats;
}

function StatCard({ icon: Icon, label, value, sub, accent }: { icon: React.ElementType; label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-card-border bg-background px-3 py-2.5">
      <div className={cn("flex size-8 items-center justify-center rounded-lg", accent || "bg-muted")}>
        <Icon className="size-4 text-foreground/70" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
        {sub && <p className="text-[9px] text-muted-foreground/70">{sub}</p>}
      </div>
    </div>
  );
}

export function StatsTab() {
  const chatId = useChatStore((s) => s.currentChatId);
  const messagesByChat = useChatStore((s) => s.messagesByChat);
  const usageByChat = useUsageStore((s) => s.byChat);
  const contextTokens = useUsageStore((s) => (chatId ? s.contextByChat[chatId] ?? 0 : 0));
  const model = useSettingsStore((s) => s.provider.model);
  const providers = useSettingsStore((s) => s.providers);
  const roles = useSettingsStore((s) => s.roles);
  const stats = useMemo(() => computeStats(chatId), [chatId, messagesByChat]);
  const chatUsage = chatId ? usageByChat[chatId] : undefined;

  const contextLimit = useMemo(() => {
    const provider = providers.find((p) => p.id === roles.chat?.providerId) ?? providers[0];
    return provider?.modelInfo?.[model]?.limit.context ?? 0;
  }, [providers, roles, model]);
  const contextPct = contextLimit > 0 ? Math.min(100, Math.round((contextTokens / contextLimit) * 100)) : 0;

  if (!chatId || stats.totalMessages === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <BarChart3 className="size-8 text-muted-foreground" />
        <h3 className="mt-3 text-sm font-semibold">No session data</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">Start a conversation to see statistics here.</p>
      </div>
    );
  }

  const topTools = Object.entries(stats.toolBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const totalFiles = new Set([...stats.filesCreated, ...stats.filesEdited]).size;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Session Statistics</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Live stats for the current conversation.</p>
      </div>

      {/* Context window — the honest "how full is memory right now" reading */}
      {contextLimit > 0 && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Context window</h4>
          <div className="rounded-lg border border-card-border bg-background px-3 py-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{fmtTokens(contextTokens)} of {fmtTokens(contextLimit)} tokens in use</span>
              <span className={cn("font-medium tabular-nums", contextPct > 90 ? "text-red-400" : contextPct > 70 ? "text-amber-400" : "text-foreground")}>{contextPct}% full</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border/40">
              <div
                className={cn("h-full rounded-full transition-[width] duration-700 ease-out", contextPct > 90 ? "bg-red-400" : contextPct > 70 ? "bg-amber-400" : "bg-primary")}
                style={{ width: `${Math.max(2, contextPct)}%` }}
              />
            </div>
          </div>
        </section>
      )}

      {/* Token usage — donut composition + cost */}
      {chatUsage && chatUsage.totalTokens > 0 && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Token usage</h4>
          <div className="flex items-center gap-4 rounded-lg border border-card-border bg-background px-3 py-3">
            <Donut
              centerLabel={fmtTokens(chatUsage.totalTokens)}
              centerSub="total"
              slices={[
                { label: "Input", value: chatUsage.inputTokens, color: "#6366f1" },
                { label: "Output", value: chatUsage.outputTokens, color: "#10b981" },
                { label: "Reasoning", value: chatUsage.reasoningTokens, color: "#ec4899" },
                { label: "Cache read", value: chatUsage.cacheReadTokens, color: "#f59e0b" },
                { label: "Cache write", value: chatUsage.cacheWriteTokens, color: "#06b6d4" },
              ].filter((s) => s.value > 0)}
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Legend label="Input" value={chatUsage.inputTokens} color="#6366f1" total={chatUsage.totalTokens} />
              <Legend label="Output" value={chatUsage.outputTokens} color="#10b981" total={chatUsage.totalTokens} />
              {chatUsage.reasoningTokens > 0 && <Legend label="Reasoning" value={chatUsage.reasoningTokens} color="#ec4899" total={chatUsage.totalTokens} />}
              {chatUsage.cacheReadTokens > 0 && <Legend label="Cache read" value={chatUsage.cacheReadTokens} color="#f59e0b" total={chatUsage.totalTokens} />}
              {chatUsage.cacheWriteTokens > 0 && <Legend label="Cache write" value={chatUsage.cacheWriteTokens} color="#06b6d4" total={chatUsage.totalTokens} />}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard icon={Hash} label="Total tokens" value={fmtTokens(chatUsage.totalTokens)} accent="bg-indigo-500/10" />
            {chatUsage.cost > 0 && <StatCard icon={Coins} label="Spent" value={`$${chatUsage.cost.toFixed(chatUsage.cost < 0.01 ? 4 : 2)}`} accent="bg-emerald-500/10" />}
            <StatCard icon={Zap} label="LLM turns" value={chatUsage.turns} accent="bg-violet-500/10" />
          </div>
        </section>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard icon={MessageSquare} label="Messages" value={stats.totalMessages} sub={`${stats.userMessages} user · ${stats.assistantMessages} assistant`} />
        <StatCard icon={Wrench} label="Tool Calls" value={stats.totalToolCalls} accent="bg-blue-500/10" />
        <StatCard icon={Terminal} label="Commands Run" value={stats.commandsRun} accent="bg-green-500/10" />
        <StatCard icon={FileCode} label="Files Touched" value={totalFiles} sub={`${stats.filesCreated.size} created · ${stats.filesEdited.size} edited`} accent="bg-amber-500/10" />
        <StatCard icon={Clock} label="Agent Time" value={formatElapsed(stats.totalDurationMs)} accent="bg-purple-500/10" />
        <StatCard icon={Zap} label="Reasoning Blocks" value={stats.reasoningBlocks} accent="bg-pink-500/10" />
        {stats.subAgents > 0 && <StatCard icon={Cpu} label="Sub-Agents" value={stats.subAgents} accent="bg-cyan-500/10" />}
        {stats.errors > 0 && <StatCard icon={Zap} label="Errors" value={stats.errors} accent="bg-red-500/10" />}
      </div>

      {/* Tool breakdown */}
      {topTools.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Top Tools</h4>
          <div className="rounded-lg border border-card-border bg-background">
            {topTools.map(([name, count], i) => {
              const pct = Math.round((count / stats.totalToolCalls) * 100);
              return (
                <div key={name} className={cn("flex items-center gap-3 px-3 py-1.5", i > 0 && "border-t border-border/50")}>
                  <code className="w-24 shrink-0 truncate text-[11px] text-foreground">{name}</code>
                  <div className="min-w-0 flex-1">
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Legend({ label, value, color, total }: { label: string; value: number; color: string; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{fmtTokens(value)}</span>
      <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground/70">{pct}%</span>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
