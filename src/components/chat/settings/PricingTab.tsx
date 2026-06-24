"use client";
import { useMemo } from "react";
import { Coins, Hash, TrendingUp } from "lucide-react";
import { useSettingsStore } from "@/lib/store/settings-store";
import { useUsageStore } from "@/lib/store/usage-store";
import { cn } from "@/lib/utils";
import type { ModelInfoSummary } from "@/types";

export function PricingTab() {
  const providers = useSettingsStore((s) => s.providers);
  const roles = useSettingsStore((s) => s.roles);
  const model = useSettingsStore((s) => s.provider.model);
  const sessionTotal = useUsageStore((s) => s.getSessionTotal());

  const activeProvider = useMemo(() => {
    const chatRole = roles.chat;
    return providers.find((p) => p.id === chatRole?.providerId) ?? providers[0];
  }, [providers, roles]);

  const activeModelInfo = activeProvider?.modelInfo?.[model];

  const allModels = useMemo(() => {
    const result: Array<{ provider: string; model: string; info: ModelInfoSummary }> = [];
    for (const p of providers) {
      if (!p.modelInfo) continue;
      for (const [id, info] of Object.entries(p.modelInfo)) {
        result.push({ provider: p.name, model: id, info });
      }
    }
    return result.sort((a, b) => a.info.cost.input - b.info.cost.input);
  }, [providers]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing & Cost</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Understand model costs and track your session spending.</p>
      </div>

      {/* Active model cost */}
      {activeModelInfo && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Active Model</h4>
          <div className="rounded-lg border border-card-border bg-background p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{model}</span>
              {activeModelInfo.family && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{activeModelInfo.family}</span>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <CostRow label="Input" value={`$${activeModelInfo.cost.input}/M tokens`} />
              <CostRow label="Output" value={`$${activeModelInfo.cost.output}/M tokens`} />
              {activeModelInfo.cost.cacheRead > 0 && <CostRow label="Cache Read" value={`$${activeModelInfo.cost.cacheRead}/M tokens`} />}
              {activeModelInfo.cost.cacheWrite > 0 && <CostRow label="Cache Write" value={`$${activeModelInfo.cost.cacheWrite}/M tokens`} />}
              <CostRow label="Context Window" value={fmtTokens(activeModelInfo.limit.context)} />
              <CostRow label="Max Output" value={fmtTokens(activeModelInfo.limit.output)} />
            </div>
          </div>
        </section>
      )}

      {/* Session spending */}
      {sessionTotal.totalTokens > 0 && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Session Spending</h4>
          <div className="grid grid-cols-3 gap-2">
            <MiniCard icon={Hash} label="Total Tokens" value={fmtTokens(sessionTotal.totalTokens)} />
            <MiniCard icon={TrendingUp} label="LLM Turns" value={String(sessionTotal.turns)} />
            <MiniCard icon={Coins} label="Est. Cost" value={sessionTotal.cost > 0 ? `$${sessionTotal.cost.toFixed(4)}` : "—"} />
          </div>
        </section>
      )}

      {/* Model pricing comparison table */}
      {allModels.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Available Models</h4>
          <div className="overflow-hidden rounded-lg border border-card-border bg-background">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/50 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium text-right">Input</th>
                  <th className="px-3 py-2 font-medium text-right">Output</th>
                  <th className="px-3 py-2 font-medium text-right">Context</th>
                </tr>
              </thead>
              <tbody>
                {allModels.map(({ model: id, info }, i) => (
                  <tr key={id} className={cn(i > 0 && "border-t border-border/30", id === model && "bg-primary/5")}>
                    <td className="px-3 py-1.5">
                      <span className={cn("font-medium", id === model ? "text-primary" : "text-foreground")}>{id}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">${info.cost.input}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">${info.cost.output}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtTokens(info.limit.context)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">Prices per million tokens. Source: models.dev catalog.</p>
        </section>
      )}

      {allModels.length === 0 && !activeModelInfo && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Coins className="size-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-semibold">No pricing data</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">Fetch models in the Providers tab to see pricing information.</p>
        </div>
      )}
    </div>
  );
}

function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </>
  );
}

function MiniCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-card-border bg-background px-2 py-2 text-center">
      <Icon className="mb-1 size-3.5 text-muted-foreground" />
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n || "—");
}
