"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import type { Feature, FeatureCategory } from "@/types";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  browser: "Browser Control",
  desktop: "Desktop Control",
  code: "Code & File Operations",
  research: "Research & Web",
  planning: "Planning & Tracking",
  agents: "Agents & Delegation",
  multimodal: "Multimodal",
  control: "Flow Control",
};

const CATEGORY_ORDER: FeatureCategory[] = ["browser", "desktop", "multimodal", "code", "research", "planning", "agents", "control"];

export function ToolsTab() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/features", { cache: "no-store" });
      const data = (await res.json()) as { features?: Feature[] };
      setFeatures(data.features ?? []);
    } catch {
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>;
  }

  const grouped = new Map<FeatureCategory, Feature[]>();
  for (const f of features) {
    const list = grouped.get(f.category) ?? [];
    list.push(f);
    grouped.set(f.category, list);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tools & Capabilities</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">All tools available to the agent, grouped by category. Tools are activated based on the current mode (agent/code/chat).</p>
      </div>

      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
        <div key={cat}>
          <h4 className="mb-1.5 text-[11px] font-medium text-muted-foreground">{CATEGORY_LABELS[cat] ?? cat}</h4>
          <div className="space-y-1">
            {grouped.get(cat)!.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-md border border-card-border bg-background px-3 py-2">
                <div className="flex size-5 items-center justify-center">
                  <Wrench className="size-3 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{f.name}</span>
                    <code className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">{f.id}</code>
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  {f.modes.map((m) => (
                    <span key={m} className={cn("rounded px-1.5 py-px text-[9px] font-medium", "bg-muted text-muted-foreground")}>{m}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
