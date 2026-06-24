"use client";
import { useMemo } from "react";
import { BarChart3, Clock, Cpu, FileCode, MessageSquare, Terminal, Wrench, Zap } from "lucide-react";
import { useChatStore, EMPTY_MESSAGES } from "@/lib/store/chat-store";
import { normalizeToolName } from "@/lib/ai/tool-display";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/hooks/use-elapsed";

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
  const stats = useMemo(() => computeStats(chatId), [chatId, messagesByChat]);

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
